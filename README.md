# RetinaEdge

Offline, explainable diabetic-retinopathy (DR) screening for rural health workers. Everything runs on one machine: no cloud, no internet after setup.

Pipeline: **fundus photo → live quality + lens coach (trained; why the photo fails, how to fix it) → DR grader (ICDR 0–4 + confidence) → lesion evidence (outlined microaneurysms, haemorrhages, exudates, cotton wool spots) + class-activation heat map → decision tier (routine / recheck / refer / urgent / second look) → patient sheet in English or Hindi with QR → local records + district dashboard.**

Built for IIC 3.0, problem statement 12 (*Explainable AI for diabetic retinopathy screening in rural India*). Research prototype. Not a medical device. Not clinically validated.

## Quick start

```bash
# 1. Python deps (3.10+)
pip install -r backend/requirements.txt

# 2. Models: either train (see below) or export the open baselines (needs train/requirements.txt, ~2 min, downloads ~200 MB once)
pip install -r train/requirements.txt
python scripts/export_grader_baseline.py      # models/dr_model.onnx  (fundus-pretrained EfficientNet-B0, MIT)
python scripts/export_lesion.py               # models/lesion_model.onnx (U-Net seresnext50, MIT)
python train/train_quality.py                 # models/quality_model.onnx (quality + lens coach; needs data/aptos, data/idrid, data/nonfundus)

# 3. Frontend (Node 18+)
cd frontend && npm install && npm run build && cd ..

# 4. Run
python run.py                # http://127.0.0.1:8000
python run.py --host 0.0.0.0 # also reachable from a phone on the same Wi-Fi
```

## Results from this repo's training run (APTOS 2019, 20% hold-out, n = 733)

| Metric | Value |
|---|---|
| Quadratic weighted kappa | 0.90 (B2, 288 px, main) · 0.91 (B2, 512 px full-res, clone) |
| Referable DR (grade ≥ 2) AUC | 0.98 (both) |
| Referable sensitivity / specificity | 0.97 / 0.90 (288) · 0.97 / 0.93 (512) |
| Lesion model, IDRiD test Dice (exudates / haemorrhages / microaneurysms) | 0.68 / 0.62 / 0.21 |
| Quality + lens coach, held-out generated set, mean AP (7 labels) | 0.99 (no_lens 0.96) |

Details and limits in `MODEL_CARD.md`. Not clinically validated.

## Training the grader yourself (recommended for the pitch)

```bash
# APTOS 2019: accept the competition rules on Kaggle, then
kaggle competitions download -c aptos2019-blindness-detection -p data/aptos && cd data/aptos && unzip -o *.zip && cd ../..
# expects data/aptos/train.csv + data/aptos/train_images/*.png

python train/train_dr.py --model efficientnet_b0 --epochs 6 --batch-size 32 --size 256   # ~25 min on a 6 GB laptop GPU
# writes models/dr_model.onnx + dr_model.json (thresholds, CAM weights, hold-out metrics) + training_summary.json + holdout_ids.csv

python train/evaluate_onnx.py --csv models/holdout_ids.csv --images data/aptos/train_images --name aptos_holdout
python train/evaluate_lesions_idrid.py --data data/idrid --split test
```

External test on a handheld phone-camera dataset (mBRSET, PhysioNet credentialed access):

```bash
python train/evaluate_onnx.py --csv data/mbrset/labels_mbrset.csv --images data/mbrset/images --id-col file --label-col final_icdr --name mbrset
```

## Layout

```
backend/    FastAPI: quality.py (gate + reasons), inference.py (ONNX grader, lesions, CAM, tiers, explanation), db.py (SQLite), app.py (API)
frontend/   Vite + React + TS. Screens: home, new screening (patient → photo → result → sheet), records, second-look queue, dashboard, about
train/      train_dr.py (regression EfficientNet on APTOS), evaluate_*.py, common.py (shared preprocessing)
scripts/    export_grader_baseline.py, export_lesion.py
models/     *.onnx + sidecar *.json (thresholds, CAM weights, metrics). Ignored by git.
data/       datasets (ignored), retinaedge.db, images/ (saved screenings)
```

## API (all local)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | model status + metadata |
| `POST /api/quality` (file) | quality gate with reason codes |
| `POST /api/analyze` (file, eye, source, force) | quality + grade + lesions + CAM + tier + explanation |
| `POST /api/screenings` | save a record (image stays on this machine) |
| `GET /api/screenings`, `/api/screenings/{id}` | records |
| `POST /api/second-look/{id}` | remote grader decision |
| `POST /api/screenings/{id}/referral-complete` | close the referral loop |
| `GET /api/dashboard/summary` | district aggregates incl. why-photos-fail |
| `GET /api/models/manifest`, `/models/*.onnx` | model files (for on-device inference clients) |

## Data and licences

- APTOS 2019 (Kaggle competition rules), IDRiD (CC BY 4.0), mBRSET (PhysioNet credentialed; do not redistribute images).
- Grader init weights: `ClementP/FundusDRGrading-efficientnet_b0` (MIT). Lesion model: `ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d` (MIT).
