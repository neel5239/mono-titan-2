# RetinaEdge model card

Research prototype. Not a medical device. Numbers below are only those produced by scripts in this repo; see `models/*.json` for the exact run.

## 1. DR severity grader (`models/dr_model.onnx`)
- Architecture: timm EfficientNet-B2, single regression output. Two served variants: **288 px** (main app, port 8000, trained on the 224-px APTOS mirror) and **512 px** (comparison clone, port 8001, trained on full-resolution APTOS, retina crop resized to 640 px). First run was B0 at 256 px (archived in `models/archive/b0_256`). after black-border crop, ImageNet normalisation.
- Initialisation: `ClementP/FundusDRGrading-efficientnet_b0` (MIT; trained on APTOS+EyePACS+DDR+IDRiD, reported QWK ≈ 0.75 on external sets). Then fine-tuned on APTOS 2019 (80% stratified) with class-balanced sampling and handheld-style augmentation (blur, vignette, glare).
- Output: continuous score mapped to ICDR 0–4 with thresholds optimised on the APTOS 20% hold-out for quadratic weighted kappa. Horizontal-flip TTA.
- Confidence: heuristic from distance to the nearest threshold and TTA disagreement. Not calibrated probability.
- Explanation: class-activation map computed from the exported final feature map and the linear head (exact for GAP + linear models). Heat maps are shown as evidence, not proof; see Sayres 2019 on their limits.
- Runs on this repo (RTX 4050 laptop GPU), same 733-image stratified hold-out for all:
  - EfficientNet-B0, 256 px, 6 epochs: hold-out QWK 0.889 (ONNX as served 0.881), referable sensitivity 0.980 / specificity 0.892, AUC 0.973.
  - **EfficientNet-B2, 288 px, 10 epochs (main app): hold-out QWK 0.905 (ONNX as served 0.904), accuracy 0.783, referable sensitivity 0.966 / specificity 0.903, AUC 0.978.** Grade-4 recall 31%; grade-0 recall 96%.
  - **EfficientNet-B2, 512 px, full-resolution APTOS, 8 epochs (clone :8001): hold-out QWK 0.918 (ONNX as served 0.912), accuracy 0.812, referable sensitivity 0.973 / specificity 0.926, AUC 0.982.** Grade-4 recall 37%; grade-0 recall 98%. Confusion: [[355,5,1,0,0],[4,39,28,2,1],[0,6,158,34,2],[0,1,10,21,7],[0,1,13,23,22]].
  - **B2-512 Pro (in training)**: same as 512 but fine-tuned with a phone-plus-lens capture simulation (ring, glare, haze, colour cast, edge fringing, non-black surround, low resolution, JPEG) on 50% of images; selected on the mean of normal and phone-simulated hold-out QWK. Target: hand-held lens photos, where the 512 model currently under-grades (a Moderate NPDR simulation is called No DR).
  - Init weights alone (no fine-tune) scored QWK 0.688 with default thresholds, 0.769 with optimised thresholds, so our fine-tuning adds +0.14 QWK.
- Confusion (B2-288, rows true / cols predicted): [[348,11,2,0,0],[4,30,37,3,0],[0,10,152,37,1],[0,0,12,23,4],[0,0,15,26,18]]. Weak boundaries remain 1 vs 2 and 3 vs 4; both pairs share the same referral action.
- External portable-camera test: `models/eval_mbrset.json` when mBRSET access is granted.
- Known limits: APTOS images come from Indian hospital cameras; performance on phone-adapter images is unverified until mBRSET is run. Grade 1 vs 2 boundary is the least reliable, which is why the second-look tier exists.

## 2. Lesion evidence model (`models/lesion_model.onnx`)
- `ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d` (MIT), U-Net, 5 classes: background, cotton wool spot, hard exudate, haemorrhage, microaneurysm. Trained by its author on IDRiD, MESSIDOR (MAPLES-DR), DDR, FGADR, RETINAL-LESIONS. Exported at 512×512.
- Reported by the author (AUC-PR): exudates ≈ 0.61–0.71, haemorrhages ≈ 0.39–0.54, microaneurysms ≈ 0.23–0.41 depending on dataset. Microaneurysm counts are therefore indicative only.
- Our check on IDRiD test (27 images, `models/eval_lesions_idrid.json`): pixel Dice hard exudates 0.68, cotton wool spots 0.68, haemorrhages 0.62, microaneurysms 0.21; image-level detection recall 100% / 64% / 93% / 93% respectively. Microaneurysm outlines are the least reliable, as expected from the literature.
- Post-processing: predictions outside the retinal disc suppressed; components below 4 px (MA) / 12 px (others) dropped; "near macula" = within 18% of the image size from the centre.

## 3. Quality and lens coach (`models/quality_model.onnx`)
- Trained in this repo (`train/train_quality.py`): timm `mobilenetv3_small_100`, ImageNet init, 7 sigmoid outputs (not_fundus, no_lens, blur, glare, dark, bright, off_centre), input 256×256, 6 MB ONNX, ~10 ms CPU.
- Data: 3,743 real fundus photos (APTOS + IDRiD) with on-the-fly controlled degradations (labels are exact by construction) + 6,899 real non-retina photos (natural-images; the archive ships two copies, so 13,798 files). 85/15 split by source image.
- Validation on a fixed generated set: mean AP 0.994; no_lens is the hardest label (AP 0.956, AUC 0.987); all others AP ≥ 0.999.
- Decision is hybrid (`backend/quality.py`): model probabilities at 0.5, but `dark` / `bright` / `blur` also need the measured brightness / sharpness to agree, and the colour-signature rule can add `not_fundus`. Lens detection only applies to live camera capture (`source=camera`); an uploaded fundus-camera file has no lens to detect.
- Limits: degradations are synthetic; real phone-adapter faults may differ. Spot check on 24 real/demo images: all 10 APTOS and 6 IDRiD images green (one IDRiD image yellow for media opacity, correct), dark/glare/off-centre demo faults caught, two synthetic non-retina images rejected. Field validation on mBRSET is the next step.
- If the model file is absent the deterministic OpenCV rules are used and the About page says so.

## 4. Decision tiers (`backend/inference.py::tier`)
- retake (ungradable) · second look (confidence < 0.5, grader/lesion disagreement, or yellow quality with any DR) · routine (grade 0, 12 months) · recheck (grade 1, 6 months) · refer (grade 2, 4 weeks) · refer urgent (grade 3–4, 1 week).
- Cut-offs follow the ICDR / Indian screening guideline logic for referable DR (moderate NPDR or worse). Site-level tuning is a planned feature.

## Intended use and non-use
Screening support and education for a hackathon demonstration. Not for diagnosis. Any deployment would require CDSCO SaMD approval and prospective validation.
