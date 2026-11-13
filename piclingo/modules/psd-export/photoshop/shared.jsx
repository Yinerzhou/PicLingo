// 【待 Mac 实机验证】Windows / Mac 共用的 ES3 ExtendScript，不依赖 UXP 或 JSON 全局对象。
(function (request) {
    var result = {ok: false, layers: [], tree: [], text_layers: 0, replacements: 0, warnings: 0};
    var step = "脚本初始化";
    var owned = [];
    var previousActive = null;
    var previousDialogs = app.displayDialogs;
    var fontNames = {};
    var startedAt = new Date().getTime();
    var startedFile = File(request.started_file);
    var eventFile = File(request.event_file);
    var usedRows = {};
    var s = stringIDToTypeID;

    function quote(value) {
        return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
            .replace(/[\x00-\x1f\u2028\u2029]/g, function (c) {
                var hex = c.charCodeAt(0).toString(16);
                return "\\u" + ("0000" + hex).slice(-4);
            }) + '"';
    }

    function encode(value) {
        if (value === null || typeof value === "undefined") { return "null"; }
        if (typeof value === "string") { return quote(value); }
        if (typeof value === "number") { return isFinite(value) ? String(value) : "null"; }
        if (typeof value === "boolean") { return String(value); }
        var parts = [];
        var i;
        if (value instanceof Array) {
            for (i = 0; i < value.length; i++) { parts.push(encode(value[i])); }
            return "[" + parts.join(",") + "]";
        }
        for (i in value) {
            if (value.hasOwnProperty(i)) { parts.push(quote(i) + ":" + encode(value[i])); }
        }
        return "{" + parts.join(",") + "}";
    }

    function write(file, text, mode) {
        file.encoding = "UTF8";
        if (!file.open(mode)) { throw new Error("无法写日志/结果：" + file.fsName + " " + file.error); }
        try {
            if (!file.write(text)) { throw new Error("写文件失败：" + file.fsName + " " + file.error); }
        } finally { file.close(); }
    }

    function log(level, name, message, details) {
        if (level === "warning") { result.warnings++; }
        write(eventFile, encode({time_ms: new Date().getTime(), level: level, step: name,
            message: message, details: details || {}}) + "\n", "a");
    }

    function errorInfo(error) {
        return {message: String(error), number: error.number, line: error.line,
            file: error.fileName, stack: error.stack || $.stack};
    }

    function checkDeadline() {
        if (new Date().getTime() > request.deadline) {
            throw new Error("任务截止时间已到，终止后续处理并清理任务副本");
        }
    }

    function timed(name, action) {
        checkDeadline();
        step = name;
        var start = new Date().getTime();
        log("info", name, "开始");
        try {
            var value = action();
            log("info", name, "完成", {elapsed_ms: new Date().getTime() - start});
            return value;
        } catch (error) {
            log("error", name, "步骤失败", {elapsed_ms: new Date().getTime() - start, error: errorInfo(error)});
            throw error;
        }
    }

    function active(doc) { app.activeDocument = doc; }

    function closeOwned(doc, save) {
        var index = -1;
        for (var i = owned.length - 1; i >= 0; i--) {
            if (owned[i] === doc) { index = i; break; }
        }
        active(doc);
        doc.close(save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES);
        if (index >= 0) { owned.splice(index, 1); }
    }

    function normalize(value) {
        value = String(value);
        var config = request.config.text_normalization;
        if (config.normalize_newlines) { value = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
        if (config.trim) { value = value.replace(/^\s+|\s+$/g, ""); }
        return config.case_sensitive ? value : value.toLowerCase();
    }

    function descriptor(layer) {
        var reference = new ActionReference();
        reference.putIdentifier(s("layer"), layer.id);
        return executeActionGet(reference);
    }

    function fontStatus(layer) {
        var names = [];
        var missing = [];
        var styles = 0;
        var runs = [];
        var text = descriptor(layer).getObjectValue(s("textKey"));
        if (text.hasKey(s("textStyleRange"))) {
            var ranges = text.getList(s("textStyleRange"));
            styles = ranges.count;
            for (var i = 0; i < ranges.count; i++) {
                var style = ranges.getObjectValue(i).getObjectValue(s("textStyle"));
                var name = style.hasKey(s("fontPostScriptName")) ? style.getString(s("fontPostScriptName")) : layer.textItem.font;
                names.push(name);
                var unavailable = style.hasKey(s("fontAvailable")) && !style.getBoolean(s("fontAvailable"));
                if (unavailable || !fontNames["$" + name]) { missing.push(name); }
                var range = ranges.getObjectValue(i);
                var run = {from: range.getInteger(s("from")), to: range.getInteger(s("to")), font: name,
                    size: style.hasKey(s("size")) ? style.getUnitDoubleValue(s("size")) : layer.textItem.size.as("pt")};
                if (style.hasKey(s("color"))) {
                    var color = style.getObjectValue(s("color"));
                    if (color.hasKey(s("red")) && color.hasKey(s("green")) && color.hasKey(s("blue"))) {
                        run.color = [color.getDouble(s("red")), color.getDouble(s("green")), color.getDouble(s("blue"))];
                    }
                }
                runs.push(run);
            }
        }
        if (names.length === 0) {
            names.push(layer.textItem.font);
            if (!fontNames["$" + layer.textItem.font]) { missing.push(layer.textItem.font); }
        }
        return {names: names, missing: missing, style_ranges: styles, runs: runs};
    }

    function findEntry(layer, route) {
        var key = normalize(request.config.match_by === "key" ? layer.name : layer.textItem.contents);
        for (var i = 0; i < request.entries.length; i++) {
            var entry = request.entries[i];
            if (typeof entry.route === "string") {
                if (entry.route === route) { return entry; }
            } else if (entry.match === key) { return entry; }
        }
        return null;
    }

    function setText(layer, text) {
        var change = new ActionDescriptor();
        var reference = new ActionReference();
        reference.putIdentifier(s("layer"), layer.id);
        change.putReference(s("null"), reference);
        change.putObject(s("to"), s("textLayer"), text);
        executeAction(s("set"), change, DialogModes.NO);
    }

    function remapRanges(text, name, styleName, oldLength, newLength, fallback, rtl) {
        if (!text.hasKey(s(name))) { return; }
        var old = text.getList(s(name));
        var updated = new ActionList();
        var contents = text.getString(s("textKey"));
        function boundary(index) {
            var previous = contents.charCodeAt(index - 1), current = contents.charCodeAt(index);
            return previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF ? index - 1 : index;
        }
        for (var i = 0; i < old.count; i++) {
            var range = old.getObjectValue(i);
            var from = Math.min(newLength, Math.floor(range.getInteger(s("from")) * newLength / Math.max(1, oldLength)));
            var to = i === old.count - 1 ? newLength + 1 : Math.min(newLength, Math.floor(range.getInteger(s("to")) * newLength / Math.max(1, oldLength)));
            from = boundary(from); to = boundary(to);
            if (to <= from) { continue; }
            range.putInteger(s("from"), from); range.putInteger(s("to"), to);
            var style = range.getObjectValue(s(styleName));
            if (styleName === "textStyle" && fallback) {
                style.putString(s("fontPostScriptName"), fallback);
                var chosen = app.fonts.getByName(fallback);
                style.putString(s("fontName"), chosen.family);
                style.putString(s("fontStyleName"), chosen.style);
                style.putBoolean(s("fontAvailable"), true);
            }
            if (rtl && styleName === "paragraphStyle") {
                // 25.x 统一排版引擎支持方向设置；旧版效果需要通过样张核验。
                style.putEnumerated(s("directionType"), s("directionType"), s("dirRightToLeft"));
                style.putBoolean(s("textEveryLineComposer"), true);
            }
            range.putObject(s(styleName), s(styleName), style);
            updated.putObject(old.getObjectType(i), range);
        }
        text.putList(s(name), updated);
    }

    function scaleText(layer, factor, minimum) {
        var text = descriptor(layer).getObjectValue(s("textKey"));
        var ranges = text.getList(s("textStyleRange"));
        var updated = new ActionList();
        var changed = false;
        for (var i = 0; i < ranges.count; i++) {
            var range = ranges.getObjectValue(i);
            var style = range.getObjectValue(s("textStyle"));
            {
                var size = style.hasKey(s("size")) ? style.getUnitDoubleValue(s("size")) : layer.textItem.size.as("pt");
                if (!style.hasKey(s("size")) && style.hasKey(s("impliedFontSize"))) { size = style.getUnitDoubleValue(s("impliedFontSize")); }
                var next = Math.max(minimum, size * factor);
                if (next < size - 0.01) { changed = true; }
                style.putUnitDouble(s("size"), charIDToTypeID("#Pnt"), Math.min(size, next));
                if (style.hasKey(s("impliedFontSize"))) { style.erase(s("impliedFontSize")); }
                if (style.hasKey(s("leading"))) {
                    style.putUnitDouble(s("leading"), s("pointsUnit"), style.getUnitDoubleValue(s("leading")) * Math.min(1, next / size));
                }
            }
            range.putObject(s("textStyle"), s("textStyle"), style);
            updated.putObject(ranges.getObjectType(i), range);
        }
        text.putList(s("textStyleRange"), updated);
        if (changed) { setText(layer, text); }
        return changed;
    }

    function bounds(layer) {
        var box = layer.bounds;
        return [box[0].as("px"), box[1].as("px"), box[2].as("px"), box[3].as("px")];
    }

    function overflow(doc, layer, before, frame) {
        var box = bounds(layer);
        var width = Math.max(1, box[2] - box[0]);
        var height = Math.max(1, box[3] - box[1]);
        var availableWidth = Math.max(1, before[2] - before[0]);
        var availableHeight = Math.max(1, before[3] - before[1]);
        var paragraph = layer.textItem.kind === TextType.PARAGRAPHTEXT;
        var measured = null;
        if (paragraph) {
            availableWidth = frame[0]; availableHeight = frame[1];
            try {
                measured = layer.duplicate();
                measured.textItem.height = UnitValue(Math.min(30000, Math.max(frame[1] * 20, doc.height.as("px") * 4)), "px");
                var full = bounds(measured);
                height = Math.max(1, full[3] - full[1]);
                width = Math.max(1, full[2] - full[0]);
            } finally { if (measured !== null) { measured.remove(); } doc.activeLayer = layer; }
        }
        var ratio = Math.min(availableWidth * 1.05 / width, availableHeight * 1.05 / height, 1);
        var outside = box[0] < -1 || box[1] < -1 || box[2] > doc.width.as("px") + 1 || box[3] > doc.height.as("px") + 1;
        return {possible: ratio < 0.99 || outside, ratio: ratio, outside_canvas: outside,
            measurement: paragraph ? "paragraph_expanded_frame" : "original_text_bounds", bounds: box};
    }

    function replaceText(doc, layer, path, visible, route) {
        var item = {path: path, layer_id: layer.id, name: layer.name, original: layer.textItem.contents,
            route: route, group: path.substring(0, path.lastIndexOf("/")), visible: visible, status: "pending"};
        result.layers.push(item);
        result.text_layers++;
        active(doc); doc.activeLayer = layer;
        item.fonts = fontStatus(layer);
        item.font_size = layer.textItem.size.as("pt");
        item.bounds = bounds(layer);
        item.alignment = String(layer.textItem.justification);
        if (request.action === "inspect") {
            item.status = "inspected";
            log("info", "读取文字", "已读取", item);
            return;
        }
        if (!visible && request.config.hidden_layers === "skip") {
            item.status = "hidden_skipped";
            log("info", "图层跳过", "隐藏文字图层保持原文", item);
            return;
        }
        active(doc);
        doc.activeLayer = layer;
        if (item.fonts.missing.length) {
            item.status = "missing_font";
            log("warning", "字体检查", "缺失字体，跳过图层", item);
            if (request.config.missing_font === "error") { throw new Error("缺失字体：" + item.fonts.missing.join(", ")); }
            return;
        }
        var entry = findEntry(layer, route);
        if (entry === null) {
            item.status = "unmatched";
            log("warning", "词条匹配", "未匹配，保留原文", item);
            if (request.config.unmatched === "error") { throw new Error("未匹配图层：" + path); }
            return;
        }
        usedRows["$" + entry.row] = true;
        item.excel_row = entry.row;
        item.translation = entry.translation;
        log("info", "词条匹配", "已匹配", {path: path, row: entry.row, original: item.original, translation: entry.translation});
        if (entry.translation === null) {
            item.status = "empty_kept";
            log("warning", "文字替换", "译文为空，保留原文", item);
            return;
        }
        var choice = entry.font_decision || {status: "unchecked", font: null};
        item.font_decision = choice;
        if (choice.status === "missing_glyphs" || choice.status === "unknown_coverage") {
            item.status = choice.status;
            log("warning", "字形检查", "没有可验证的完整字形字体，保留原文", item);
            return;
        }
        var wasLocked = layer.allLocked;
        layer.allLocked = false;
        var before = bounds(layer);
        var frame = layer.textItem.kind === TextType.PARAGRAPHTEXT ? [layer.textItem.width.as("px"), layer.textItem.height.as("px")] : null;
        var translation = entry.translation.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        var text = descriptor(layer).getObjectValue(s("textKey"));
        var rtl = /^(ar|he|fa|ur)(-|$)/.test(request.target || "");
        if (rtl && !request.config.rtl_enabled) { throw new Error("RTL 实验尚未启用"); }
        text.putString(s("textKey"), translation);
        remapRanges(text, "textStyleRange", "textStyle", item.original.length, translation.length, choice.font, rtl);
        remapRanges(text, "paragraphStyleRange", "paragraphStyle", item.original.length, translation.length, null, rtl);
        setText(layer, text);
        if (item.fonts.style_ranges > 1) { item.rich_text_mapping = "proportional_ranges"; }
        if (rtl) { item.rtl_experimental = true; log("warning", "RTL实验", "已设置段落方向，连字、标点和数字需客户验收", {path: path, version: app.version}); }
        item.overflow = overflow(doc, layer, before, frame);
        if (item.overflow.possible && request.config.overflow.strategy === "shrink") {
            for (var attempt = 0; attempt < 10 && item.overflow.possible; attempt++) {
                if (!scaleText(layer, Math.min(0.92, Math.max(0.1, item.overflow.ratio)), request.config.overflow.minimum_font_size)) { break; }
                item.overflow = overflow(doc, layer, before, frame);
            }
            item.final_font_size = layer.textItem.size.as("pt");
        }
        if (item.overflow.possible) { log("warning", "溢出检查", "可能溢出", item); }
        item.status = "replaced";
        result.replacements++;
        log("info", "文字替换", "已替换", item);
        layer.allLocked = wasLocked;
    }

    function documentIds() {
        var ids = {};
        for (var i = 0; i < app.documents.length; i++) { ids["$" + app.documents[i].id] = true; }
        return ids;
    }

    function processSmart(doc, layer, path, visible, depth, route) {
        var item = {path: path, route: route, layer_id: layer.id, status: "pending", type: "smart_object"};
        result.layers.push(item);
        active(doc);
        doc.activeLayer = layer;
        var object = descriptor(layer).getObjectValue(s("smartObject"));
        if (!object.hasKey(s("linked"))) {
            item.status = "unknown_object_unprocessed";
            log("warning", "智能对象", "无法确定对象是否链接，保持原样", item);
            return;
        }
        if (object.getBoolean(s("linked"))) {
            item.status = "linked_unprocessed";
            log("warning", "智能对象", "链接对象未处理", item);
            return;
        }
        if ((!visible && request.config.hidden_layers === "skip" && request.action !== "inspect") || request.config.smart_objects.embedded === "skip") {
            item.status = "embedded_skipped";
            log("info", "智能对象", "按配置跳过内嵌对象", item);
            return;
        }
        if (depth >= request.config.smart_objects.max_depth) {
            item.status = "depth_unprocessed";
            log("warning", "智能对象", "已到嵌套深度上限", item);
            return;
        }
        // AI/PDF/RAW 等内容可能启动外部编辑器，阶段 1 仅处理 PS 原生内容。
        var reference = object.hasKey(s("fileReference")) ? object.getString(s("fileReference")) : "";
        if (!/\.(psd|psb)$/i.test(reference)) {
            item.status = "non_psd_unprocessed";
            log("warning", "智能对象", "仅处理内嵌 PSD/PSB，对象保持原样", {path: path, reference: reference});
            return;
        }
        var existing = documentIds();
        var wasLocked = layer.allLocked;
        layer.allLocked = false;
        // “通过拷贝新建智能对象”建立独立内容，防止回写用户打开的其他实例。
        executeAction(s("placedLayerMakeCopy"), new ActionDescriptor(), DialogModes.NO);
        var independent = doc.activeLayer;
        if (independent.id === layer.id) { throw new Error("无法建立独立智能对象副本：" + path); }
        independent.name = layer.name;
        layer.remove();
        executeAction(s("placedLayerEditContents"), new ActionDescriptor(), DialogModes.NO);
        var inner = app.activeDocument;
        if (existing["$" + inner.id]) { throw new Error("智能对象编辑复用了已有文档，已停止以保护用户文件：" + path); }
        owned.push(inner);
        log("info", "读取内嵌图层", "发现内嵌文字图层", {path: path, count: countText(inner)});
        var before = result.replacements;
        walk(inner, inner, path + "/[内嵌]", visible, depth + 1, route + "/contents");
        closeOwned(inner, result.replacements > before);
        active(doc);
        independent.allLocked = wasLocked;
        item.status = "embedded_processed";
        log("info", "智能对象", "内嵌对象处理完成", item);
    }

    function walk(doc, container, prefix, parentVisible, depth, parentRoute) {
        var layers = [];
        var i;
        // 智能对象操作会改变容器长度，先固定本次遍历的对象引用。
        for (i = 0; i < container.layers.length; i++) { layers.push(container.layers[i]); }
        for (i = 0; i < layers.length; i++) {
            checkDeadline();
            var layer = layers[i];
            var visible = parentVisible && layer.visible;
            var path = prefix + "/" + layer.name;
            var route = (parentRoute ? parentRoute + "/" : "") + i;
            result.tree.push({path: path, route: route, name: layer.name, visible: visible,
                type: layer.typename === "LayerSet" ? "group" : String(layer.kind)});
            if (layer.typename === "LayerSet") {
                var groupLocked = layer.allLocked;
                if (layer.allLocked) { layer.allLocked = false; }
                walk(doc, layer, path, visible, depth, route);
                layer.allLocked = groupLocked;
            } else if (layer.kind === LayerKind.TEXT) {
                timed("处理文字图层 " + path, function () { replaceText(doc, layer, path, visible, route); });
            } else if (layer.kind === LayerKind.SMARTOBJECT) {
                timed("处理智能对象 " + path, function () { processSmart(doc, layer, path, visible, depth, route); });
            }
        }
    }

    function countText(container) {
        var count = 0;
        for (var i = 0; i < container.layers.length; i++) {
            var layer = container.layers[i];
            if (layer.typename === "LayerSet") { count += countText(layer); }
            else if (layer.kind === LayerKind.TEXT) { count++; }
        }
        return count;
    }

    function sourceCopy() {
        var input = File(request.input);
        if (!input.exists) { throw new Error("输入 PSD 不存在：" + input.fsName); }
        var source = null;
        var reused = false;
        for (var i = 0; i < app.documents.length; i++) {
            try {
                var name = app.documents[i].fullName.fsName;
                var inputName = input.fsName;
                if ($.os.toLowerCase().indexOf("windows") >= 0) {
                    name = name.toLowerCase(); inputName = inputName.toLowerCase();
                }
                if (name === inputName) { source = app.documents[i]; reused = true; break; }
            } catch (unsaved) { /* 未保存文档没有 fullName，继续查找。 */ }
        }
        if (source === null) { source = app.open(input); owned.push(source); }
        if (reused && !source.saved) {
            throw new Error("输入 PSD 已在 Photoshop 中打开且存在未保存修改，请先保存或关闭该文档");
        }
        active(source);
        var copy = source.duplicate("PicLingo-" + new Date().getTime(), false);
        owned.push(copy);
        if (!reused) { closeOwned(source, false); }
        active(copy);
        log("info", "打开PSD", "已建立内存副本", {input: input.fsName, reused_open_document: reused,
            dimensions: [copy.width.as("px"), copy.height.as("px")]});
        return copy;
    }

    function translate() {
        var doc = timed("打开PSD", sourceCopy);
        result.dimensions = [Math.round(doc.width.as("px")), Math.round(doc.height.as("px"))];
        log("info", "读取图层", "发现文字图层", {count: countText(doc), embedded_contents_counted_on_open: true});
        timed("读取字体", function () {
            if (request.action === "inspect") { result.available_fonts = []; }
            for (var i = 0; i < app.fonts.length; i++) {
                fontNames["$" + app.fonts[i].postScriptName] = true;
                if (request.action === "inspect") { result.available_fonts.push(app.fonts[i].postScriptName); }
            }
            log("info", "读取字体", "字体索引完成", {font_count: app.fonts.length});
        });
        timed("遍历替换", function () { walk(doc, doc, "", true, 0); });
        if (request.action === "inspect") { return; }
        result.unused_excel_rows = [];
        for (var i = 0; i < request.entries.length; i++) {
            if (!usedRows["$" + request.entries[i].row]) { result.unused_excel_rows.push(request.entries[i].row); }
        }
        log("info", "匹配汇总", "图层处理结束", {text_layers: result.text_layers, replacements: result.replacements,
            unused_excel_rows: result.unused_excel_rows});
        if (result.replacements === 0) { log("warning", "匹配汇总", "没有文字被替换，请检查图层状态及 Excel 匹配结果"); }
        var format = request.config.output.format;
        if (format === "psd") {
            timed("导出PSD", function () {
                var options = new PhotoshopSaveOptions(); options.layers = true; options.embedColorProfile = true;
                doc.convertProfile(request.config.output.color_profile, Intent.RELATIVECOLORIMETRIC, true, false);
                result.color_profile = doc.colorProfileName;
                doc.saveAs(File(request.output), options, true, Extension.LOWERCASE);
                result.output = File(request.output).fsName;
            });
            return;
        }
        timed("转换颜色", function () {
            active(doc);
            // PNG 为 RGB/8 位。仅在任务副本中合并渲染后转换，保留透明区域。
            doc = doc.duplicate("PicLingo-export-" + new Date().getTime(), true);
            owned.push(doc);
            active(doc);
            if (doc.mode !== DocumentMode.RGB) { doc.changeMode(ChangeMode.RGB); }
            doc.convertProfile(request.config.output.color_profile, Intent.RELATIVECOLORIMETRIC, true, false);
            result.color_profile = doc.colorProfileName;
            if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT) { doc.bitsPerChannel = BitsPerChannelType.EIGHT; }
            log("info", "转换颜色", "已转换到输出配置", {profile: request.config.output.color_profile, bits: 8});
        });
        timed("导出" + format.toUpperCase(), function () {
            var output = File(request.output);
            if (output.exists) { throw new Error("临时输出已存在，拒绝覆盖：" + output.fsName); }
            var options;
            if (format === "jpg") {
                doc.flatten(); options = new JPEGSaveOptions();
                options.quality = Math.round(request.config.output.jpg_quality * 12 / 100);
                options.embedColorProfile = true; options.formatOptions = FormatOptions.STANDARDBASELINE;
            } else {
                options = new PNGSaveOptions(); options.interlaced = false; options.compression = 6;
            }
            doc.saveAs(output, options, true, Extension.LOWERCASE);
            if (!output.exists || output.length === 0) { throw new Error("Photoshop 未生成有效输出"); }
            result.output = output.fsName;
            log("info", "导出PNG", "临时 PNG 已保存", {path: output.fsName, bytes: output.length});
        });
    }

    function fixture() {
        var folder = Folder(request.folder);
        if (!folder.exists && !folder.create()) { throw new Error("无法创建样本目录"); }
        var strings = ["Summer Sale", "Save up to 50%", "Shop Now"];
        var keys = ["headline", "discount", "button"];
        var font = app.fonts[0].postScriptName;
        try { font = app.fonts.getByName("ArialMT").postScriptName; } catch (noArial) { }
        for (var count = 1; count <= 3; count += 2) {
            timed("生成 " + count + " 层 PSD", function () {
                var doc = app.documents.add(1200, 800, 72, "PicLingo 测试", NewDocumentMode.RGB, DocumentFill.WHITE);
                owned.push(doc);
                for (var i = 0; i < count; i++) {
                    var layer = doc.artLayers.add();
                    layer.kind = LayerKind.TEXT;
                    layer.name = keys[i];
                    layer.textItem.contents = strings[i];
                    layer.textItem.font = font;
                    layer.textItem.size = UnitValue(48, "pt");
                    layer.textItem.position = [UnitValue(100, "px"), UnitValue(180 + i * 200, "px")];
                    var color = new SolidColor(); color.rgb.hexValue = "1D1D1F";
                    layer.textItem.color = color;
                }
                var output = File(folder.fsName + (count === 1 ? "/最小 测试 1层.psd" : "/多层 测试 3层.psd"));
                if (output.exists) { throw new Error("样本已存在：" + output.fsName); }
                var options = new PhotoshopSaveOptions(); options.layers = true;
                doc.saveAs(output, options, false, Extension.LOWERCASE);
                closeOwned(doc, false);
                log("info", "测试PSD", "样本已保存", {path: output.fsName, text_layers: count, font: font});
            });
        }
    }

    // 驱动重发时拒绝再次执行，避免不确定失败触发重复变更。
    if (startedFile.exists) { throw new Error("此任务已经进入脚本引擎，禁止重复执行，请检查既有结果"); }
    write(startedFile, String(new Date().getTime()), "w");
    try {
        if (app.documents.length) { previousActive = app.activeDocument; }
        log("info", "脚本环境", "Photoshop 脚本已启动", {version: app.version, os: $.os});
        var major = parseInt(app.version, 10);
        if (major !== request.config.photoshop.expected_major) {
            log("warning", "版本检查", "当前 Photoshop 主版本与目标版本不同", {actual: app.version,
                expected_major: request.config.photoshop.expected_major});
            if (request.config.photoshop.strict_version) { throw new Error("Photoshop 主版本不符合配置"); }
        }
        app.displayDialogs = DialogModes.NO;
        log("info", "对话框设置", "暂时禁用可抑制的脚本对话框，结束后恢复原设置", {
            missing_fonts: "跳过并报告", color_mismatch: "由当前策略无交互打开，输出副本统一转 sRGB",
            existing_modal: "脚本执行前已有的模态窗口由桥接层检测并有限重试"});
        if (request.action === "fixture") { fixture(); }
        else if (request.action === "translate" || request.action === "inspect") { translate(); }
        else { throw new Error("未知脚本操作"); }
        result.ok = true;
    } catch (error) {
        result.failed_step = step;
        result.error = errorInfo(error);
        log("error", step, "Photoshop 步骤失败", {error: result.error,
            possible_causes: ["字体或文件不可用", "图层类型或文档模式不兼容", "Photoshop 忙碌", "颜色配置或导出失败"]});
    } finally {
        for (var i = owned.length - 1; i >= 0; i--) {
            try { active(owned[i]); owned[i].close(SaveOptions.DONOTSAVECHANGES); }
            catch (closeError) {
                result.ok = false;
                result.failed_step = "清理副本";
                result.error = errorInfo(closeError);
                result.cleanup_error = errorInfo(closeError);
                log("error", "清理副本", "关闭任务文档失败，请检查 Photoshop", {error: result.cleanup_error});
            }
        }
        try { if (previousActive !== null) { active(previousActive); } }
        catch (activeError) { log("warning", "恢复活动文档", "未能恢复原活动文档", errorInfo(activeError)); }
        try { app.displayDialogs = previousDialogs; }
        catch (dialogError) {
            result.ok = false; result.failed_step = "恢复设置";
            result.error = errorInfo(dialogError); result.settings_error = errorInfo(dialogError);
            log("error", "恢复设置", "恢复 Photoshop 对话框设置失败", errorInfo(dialogError));
        }
        result.elapsed_ms = new Date().getTime() - startedAt;
        write(File(request.result_file), encode(result), "w");
        log("info", "脚本结束", result.ok ? "成功" : "失败", {elapsed_ms: result.elapsed_ms});
    }
    return "PICLINGO_RESULT " + (result.ok ? "OK " : "FAILED ") + request.result_file;
}(PL_REQUEST));
