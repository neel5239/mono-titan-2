# Models

This folder intentionally does not contain fake clinical weights.

After training:
- `dr_model.onnx` = fine-tuned EfficientNet-B0, 5-class DR severity.
- `lesion_model.onnx` = compact U-Net, 4 lesion classes + background.

The frontend/backend only treats these files as real models when they exist. Otherwise it stays in clearly-labelled demo mode.
