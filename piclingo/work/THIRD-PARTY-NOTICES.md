# PicLingo third-party notices

PicLingo application code and original icon: Copyright (c) 2026 PicLingo contributors. MIT License (see LICENSE.txt). This is an independent application; no PicWish, Yandex, ImageTranslate, or other proprietary code or brand assets are included in the program.

## Models

Chinese–English and English–Chinese: Argos Translate model packages 1.9 from https://argos-net.com/ , packaged from OPUS-MT models. Original models licensed under Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/ . Authors: Jörg Tiedemann and Santhosh Thottingal, "OPUS-MT — Building open translation services for the World", Proceedings of EAMT 2020, Lisbon, Portugal. The original README is preserved in each model folder. PicLingo excludes the unused Stanza tokenizer weights and uses source SentencePiece tokenization plus sentence/chunk splitting. Model inference weights are otherwise unmodified.

OCR: RapidOCR / PaddleOCR Chinese PP-OCR models. RapidOCR: https://github.com/RapidAI/RapidOCR , Apache-2.0. PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR , Apache-2.0. The package's model and configuration files are retained.

## Runtime components

- PySide6 / Shiboken / Qt: LGPL-3.0 (open-source option), https://www.qt.io/qt-for-python and https://code.qt.io/cgit/pyside/pyside-setup.git/ . PicLingo dynamically links to the included DLLs. Qt/PySide libraries in `_internal` may be replaced with ABI-compatible modified builds. PicLingo imposes no restriction on reverse engineering for debugging modifications to these libraries. Corresponding upstream source: https://download.qt.io/official_releases/QtForPython/pyside6/ and https://download.qt.io/archive/qt/ ; use the versions listed in `dependencies.txt`.
- CTranslate2: MIT, https://github.com/OpenNMT/CTranslate2 . Its wheel may include Intel OpenMP and NVIDIA cuDNN loader components under their respective bundled notices; CPU inference is selected explicitly.
- SentencePiece: Apache-2.0, https://github.com/google/sentencepiece .
- ONNX Runtime: MIT, https://github.com/microsoft/onnxruntime .
- OpenCV: Apache-2.0, https://github.com/opencv/opencv .
- NumPy: BSD-3-Clause, https://numpy.org/ .
- Pillow: HPND and bundled codecs, https://python-pillow.org/ .
- Shapely: BSD-3-Clause and GEOS LGPL-2.1, https://shapely.readthedocs.io/ .
- Pyclipper: MIT / Boost Software License, https://github.com/fonttools/pyclipper .
- Requests: Apache-2.0; urllib3: MIT; certifi: MPL-2.0; charset-normalizer: MIT; idna: BSD-3-Clause.
- Python: PSF license, https://www.python.org/ . PyInstaller bootloader: GPL-2.0 with distribution exception, https://pyinstaller.org/ .
- Microsoft Visual C++ redistributable runtime: Microsoft license; copied runtime DLLs are redistributed as dependencies of this application.

Original package license files and additional component notices are collected in `licenses/`. System fonts are used from the user's Windows installation and are not redistributed.
