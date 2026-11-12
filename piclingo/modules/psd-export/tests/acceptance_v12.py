"""Windows Photoshop 实机检查，覆盖批量、富文本、字体、溢出与多种格式。"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cli
from service import configuration, export_batch, inspect_files, matches, workbook


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    root = cli.RESOURCE_ROOT / "release" / ("acceptance-v12-" + time.strftime("%Y%m%d-%H%M%S"))
    root.mkdir()
    config = configuration({}, root)
    source = root / "复杂 测试.psd"
    driver = root / "fixture.jsx"
    driver.write_text("""(function(){
        var previous=app.documents.length ? app.activeDocument : null;
        var old=app.displayDialogs, doc=null;
        try {
            app.displayDialogs=DialogModes.NO;
            doc=app.documents.add(1200,800,72,'PicLingo v12 test',NewDocumentMode.RGB,DocumentFill.WHITE);
            var strings=['Summer Sale','Save up to 50%','Shop Now'];
            var names=['headline','discount','button'];
            for(var i=0;i<3;i++){
                var layer=doc.artLayers.add();layer.kind=LayerKind.TEXT;layer.name=names[i];
                layer.textItem.font='ArialMT';layer.textItem.size=UnitValue(48,'pt');
                if(i===1){layer.textItem.kind=TextType.PARAGRAPHTEXT;layer.textItem.width=UnitValue(260,'px');layer.textItem.height=UnitValue(90,'px');}
                layer.textItem.position=[UnitValue(80,'px'),UnitValue(150+i*220,'px')];layer.textItem.contents=strings[i];
                if(i===0){
                    var s=stringIDToTypeID, ref=new ActionReference();ref.putIdentifier(s('layer'),layer.id);
                    var text=executeActionGet(ref).getObjectValue(s('textKey')), ranges=new ActionList();
                    for(var r=0;r<2;r++){
                        var range=new ActionDescriptor(), style=new ActionDescriptor(), color=new ActionDescriptor();
                        range.putInteger(s('from'),r===0?0:6);range.putInteger(s('to'),r===0?6:strings[i].length+1);
                        style.putString(s('fontPostScriptName'),r===0?'Arial-BoldMT':'ArialMT');
                        style.putUnitDouble(s('size'),charIDToTypeID('#Pnt'),r===0?48:32);
                        color.putDouble(s('red'),r===0?20:200);color.putDouble(s('green'),30);color.putDouble(s('blue'),r===0?180:20);
                        style.putObject(s('color'),s('RGBColor'),color);range.putObject(s('textStyle'),s('textStyle'),style);
                        ranges.putObject(s('textStyleRange'),range);
                    }
                    text.putList(s('textStyleRange'),ranges);var change=new ActionDescriptor();change.putReference(s('null'),ref);change.putObject(s('to'),s('textLayer'),text);executeAction(s('set'),change,DialogModes.NO);
                }
            }
            var options=new PhotoshopSaveOptions();options.layers=true;
            doc.saveAs(File(OUTPUT),options,false,Extension.LOWERCASE);return 'ok';
        }finally{if(doc){doc.close(SaveOptions.DONOTSAVECHANGES);}if(previous){app.activeDocument=previous;}app.displayDialogs=old;}
    }());""".replace("OUTPUT", json.dumps(str(source), ensure_ascii=True)), encoding="utf-8-sig")
    cli.invoke_bridge(config, driver, root, cli.Journal(root / "fixture.log"))
    excel = cli.RESOURCE_ROOT / "samples/测试 样本/翻译 模板.xlsx"
    before = cli.file_hash(source)
    results = []

    def run(name, settings, languages=("de",), paths=None, manual=None):
        job = root / name
        job.mkdir()
        current = configuration(settings, job)
        request = {"files": paths or [str(source)], "excel": str(excel), "languages": list(languages),
                   "naming": "{文件名}_{语言}", "output_dir": str(root / "output" / name), "manual": manual or {}}
        report = export_batch(request, current, job)
        assert cli.file_hash(source) == before
        return report

    for output_format in ("png", "jpg", "psd"):
        report = run(output_format, {"output": {"format": output_format}})
        assert report["success_count"] == 1, report
        path = Path(report["results"][0]["output"])
        assert path.read_bytes().startswith({"png": b"\x89PNG", "jpg": b"\xff\xd8", "psd": b"8BPS"}[output_format])
        results.append({"name": output_format, "passed": True})
        if output_format == "psd":
            inspected = inspect_files([str(path)], config)[0]
            headline = next(layer for layer in inspected["layers"] if layer.get("name") == "headline")
            assert headline["fonts"]["style_ranges"] == 2, headline
            assert set(headline["fonts"]["names"]) == {"Arial-BoldMT", "ArialMT"}, headline
            assert {round(run["size"]) for run in headline["fonts"]["runs"]} == {48, 32}, headline
            assert len({tuple(run.get("color", [])) for run in headline["fonts"]["runs"]}) == 2, headline
            results.append({"name": "富文本字体字号颜色保持", "passed": True})
    shrink = run("shrink", {"overflow": {"strategy": "shrink", "minimum_font_size": 8}})
    assert shrink["success_count"] == 1
    layers = shrink["results"][0]["photoshop"]["layers"]
    assert any(layer.get("final_font_size", 48) < 48 for layer in layers)
    assert all(layer.get("final_font_size", 48) >= 8 for layer in layers)
    assert not any(layer["overflow"]["possible"] for layer in layers), layers
    results.append({"name": "段落与点文字自动缩小", "passed": True})
    docs = inspect_files([str(source)], config)
    book = workbook(excel, config)
    manual = {str(source): {layer["route"]: next(row["row"] for row in book["rows"] if row["key"] == layer["name"]) for layer in docs[0]["layers"]}}
    manual_report = run("manual", {"match_by": "manual"}, manual=manual)
    assert manual_report["results"][0]["photoshop"]["replacements"] == 3
    results.append({"name": "手动指定", "passed": True})
    bad = root / "坏文件.psd"; bad.write_bytes(b"bad PSD")
    batch = run("batch", {}, languages=("de", "fr"), paths=[str(bad), str(source)])
    assert batch["success_count"] == 2 and batch["failure_count"] == 2, batch
    results.append({"name": "多个PSD乘多语言及失败继续", "passed": True})
    japanese = run("japanese", {}, languages=("ja",))
    assert japanese["success_count"] == 1
    japanese_layers = japanese["results"][0]["photoshop"]["layers"]
    assert all(layer["status"] == "replaced" for layer in japanese_layers), japanese_layers
    assert all(layer["font_decision"]["status"] == "fallback" for layer in japanese_layers), japanese_layers
    results.append({"name": "日文字形检查与字体回退", "passed": True})
    (root / "summary.json").write_text(json.dumps({"results": results, "all_passed": True, "ps2024_verified": False, "mac_verified": False}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("ALL_PASSED " + str(root))


if __name__ == "__main__":
    main()
