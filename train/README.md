# RetinaCoach model training

## 1. DR severity
```bash
pip install -r train/requirements.txt
python train/train_dr.py --data data/aptos --out models
```
This fine-tunes ImageNet-pretrained EfficientNet-B0 on APTOS 0–4 DR labels, uses a stratified holdout, class-balanced sampling, augmentation, and reports accuracy, balanced accuracy and quadratic weighted kappa.

## 2. Lesion evidence
```bash
python train/train_lesions.py --data data/idrid --out models
```
This trains a compact U-Net on the IDRiD pixel masks for microaneurysm, hemorrhage, hard exudate and soft exudate. Because only 81 images have pixel masks, treat this as an explainability prototype, not a clinical-grade lesion detector.

## 3. External portable-camera evaluation
```bash
python train/evaluate_mbrset.py --data data/mbrset --model models/dr_model.onnx
```
Do not use mBRSET for tuning if it is your external test set. Keep it untouched until the final evaluation.
