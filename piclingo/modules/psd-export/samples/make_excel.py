"""【待 Mac 实机验证】生成与测试 PSD 对应的 Excel，不覆盖既有文件。"""
import argparse
from pathlib import Path

from openpyxl import Workbook


def main():
    parser = argparse.ArgumentParser(description="生成 PSD 翻译样表")
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).parent / "测试 样本")
    args = parser.parse_args()
    folder = args.out_dir.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    content = [
        ["headline", "Summer Sale", "Sommeraktion", "Soldes d’été", "サマーセール"],
        ["discount", "Save up to 50%", "Bis zu 50% sparen", "Jusqu’à 50 % de réduction", "最大50%オフ"],
        ["button", "Shop Now", "Jetzt einkaufen", "Acheter", "今すぐ購入"]
    ]
    variants = {
        "翻译 模板.xlsx": (["Key", "en", "de", "fr", "ja"], content),
        "英文首列 变体.xlsx": (["English", "DE", "French", "日文"], [row[1:] for row in content]),
        "中文表头 变体.xlsx": (["英文原文", "德语", "法文", "Japanese"], [row[1:] for row in content])
    }
    for name, (headers, rows) in variants.items():
        path = folder / name
        if path.exists():
            raise FileExistsError("文件已存在，拒绝覆盖：" + str(path))
        book = Workbook()
        sheet = book.active
        sheet.title = "Translations"
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
        sheet.freeze_panes = "A2"
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = 32
        book.save(path)
        book.close()
        print(path)


if __name__ == "__main__":
    main()
