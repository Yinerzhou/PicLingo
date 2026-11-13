"""【待 Mac 实机验证】Excel 识别及匹配，共用逻辑可独立测试。"""
import re


def header_token(value):
    return str(value or "").strip().casefold().replace("_", "-")


def language_code(value, config):
    token = header_token(value)
    for code, aliases in config["language_aliases"].items():
        if token in {header_token(item) for item in [code] + aliases}:
            return code
    # 未列入映射的列只接受明确的语言代码，避免将备注当语言。
    if re.fullmatch(r"[a-z]{2}(?:-[a-z]{2})?", token):
        parts = token.split("-")
        return parts[0] + ("-" + parts[1].upper() if len(parts) == 2 else "")
    return None


def normalize_text(value, config):
    value = str(value)
    options = config["text_normalization"]
    if options["normalize_newlines"]:
        value = value.replace("\r\n", "\n").replace("\r", "\n")
    if options["trim"]:
        value = value.strip()
    return value if options["case_sensitive"] else value.lower()


def read_excel(path, requested_language, config, log):
    from openpyxl import load_workbook

    target = language_code(requested_language, config)
    if not target:
        raise ValueError("目标语言无法识别，请在 language_aliases 中配置")
    if target.split("-")[0] in ("ar", "he", "fa", "ur") and not config.get("rtl_enabled"):
        raise ValueError("请先启用实验性 RTL，阿拉伯语/希伯来语排版需客户样张验收")
    book = load_workbook(path, read_only=True, data_only=False)
    try:
        sheet_name = config["worksheet"]
        if sheet_name is None and len(book.sheetnames) != 1:
            raise ValueError("Excel 包含多个工作表，请在 worksheet 中指定工作表名称")
        sheet = book[sheet_name] if sheet_name else book[book.sheetnames[0]]
        rows = sheet.iter_rows(min_row=config["header_row"])
        header_cells = next(rows, None)
        if not header_cells:
            raise ValueError("Excel 没有表头")
        headers = [cell.value for cell in header_cells]
        languages = {}
        key_column = None
        source_column = None
        key_headers = {header_token(item) for item in config["key_headers"]}
        source_headers = {header_token(item) for item in config["source_headers"]}
        for index, header in enumerate(headers):
            token = header_token(header)
            if token in key_headers:
                if key_column is not None:
                    raise ValueError("存在多个 Key 列，请删除歧义列")
                key_column = index
            elif token in source_headers:
                if source_column is not None:
                    raise ValueError("存在多个原文列")
                source_column = index
            else:
                code = language_code(header, config)
                if code:
                    if code in languages:
                        raise ValueError("多个表头映射到同一种语言：" + code)
                    languages[code] = index
        english_column = languages.get(config["source_language"])
        if source_column is not None and english_column is not None:
            raise ValueError("原文列与源语言列同时存在，请在模板中保留一个")
        source_column = source_column if source_column is not None else english_column
        # 无 Key 且无已知原文表头时，首列作为原文，记录该推断。
        if source_column is None and key_column is None:
            if 0 in languages.values():
                raise ValueError("首列已识别为目标语言，无法推断英文原文列")
            source_column = 0
            log("warning", "Excel识别", "首列表头未知，按英文原文处理", header=headers[0])
        if target not in languages:
            raise ValueError("Excel 中未找到目标语言列：" + target)
        match_column = key_column if config["match_by"] == "key" else source_column
        if config["match_by"] == "manual":
            match_column = key_column if key_column is not None else source_column
        if match_column is None:
            raise ValueError("所选匹配方式缺少对应列，请检查 match_by 与表头")
        log("info", "Excel识别", "表头识别完成", worksheet=sheet.title,
            headers=headers, language_columns={code: index + 1 for code, index in languages.items()},
            source_column=None if source_column is None else source_column + 1,
            key_column=None if key_column is None else key_column + 1, target=target,
            match_by=config["match_by"], target_name=config["language_names"].get(target, target))
        entries = []
        seen_columns = {}
        for number, cells in enumerate(rows, config["header_row"] + 1):
            values = [cell.value for cell in cells]
            if all(value is None or value == "" for value in values):
                continue
            for cell in cells:
                if cell.data_type in ("f", "e"):
                    raise ValueError("第 %s 行包含公式或错误值，请粘贴为纯文本后导入" % number)
            source = values[match_column]
            if source is None or not str(source).strip():
                log("warning", "Excel读取", "匹配列为空，跳过行", row=number)
                continue
            key = normalize_text(source, config)
            duplicate_fields = []
            for label, column in (("Key", key_column), ("原文", source_column)):
                if column is None or values[column] is None or not str(values[column]).strip():
                    continue
                normalized = normalize_text(values[column], config)
                seen = seen_columns.setdefault(label, set())
                if normalized in seen:
                    duplicate_fields.append(label)
            if duplicate_fields:
                if config["duplicates"] == "error":
                    raise ValueError("重复词条，第 %s 行：%s" % (number, key))
                log("warning", "Excel读取", "重复词条，使用第一条", row=number, key=key, fields=duplicate_fields)
                continue
            for label, column in (("Key", key_column), ("原文", source_column)):
                if column is not None and values[column] is not None and str(values[column]).strip():
                    seen_columns.setdefault(label, set()).add(normalize_text(values[column], config))
            translation = values[languages[target]]
            if translation is None or not str(translation).strip():
                if config["empty_translation"] == "error":
                    raise ValueError("第 %s 行译文为空" % number)
                translation = None
                log("warning", "Excel读取", "空译文，保留原文", row=number, key=key)
            entries.append({"row": number, "match": key,
                            "key": None if key_column is None else str(values[key_column] or ""),
                            "source": None if source_column is None else str(values[source_column] or ""),
                            "translation": None if translation is None else str(translation)})
        if not entries:
            raise ValueError("Excel 中没有可用词条")
        return target, entries
    finally:
        book.close()
