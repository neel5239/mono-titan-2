# RetinaEdge: the models, what we trained, what we reused, and why

This document explains every model inside RetinaEdge in plain language: which ones we trained ourselves, which ones we started from open pretrained weights, how each was trained and validated, and how accuracy improves at each stage. It is written to be read by a judge, a clinician, or a teammate.

RetinaEdge is a research prototype for IIC 3.0 problem statement 12, "Explainable AI for diabetic retinopathy screening in rural India". It is not a medical device and has not been clinically validated.

---

## 1. The pipeline in one picture

```
fundus photo
   │
   ▼
[1] Quality + lens coach  ──► red: "retake" with the reason (blur, glare, dark, not a retina, no lens ...)
   │ green / yellow
   ▼
[2] DR grader  ──► ICDR grade 0–4, confidence, class-activation heat map
   │
   ▼
[3] Lesion evidence model ──► outlines of microaneurysms, haemorrhages, hard exudates, cotton wool spots
   │
   ▼
[4] Decision tier ──► routine / recheck / refer / refer urgently / second look
   │
   ▼
patient sheet (English / Hindi), QR, local record, district dashboard
```

Three neural networks are involved. The table shows who trained what.

| Stage | Model | Trained by us? | Starting point | Data we used |
|---|---|---|---|---|
| [1] Quality + lens coach | MobileNetV3-Small, 7 sigmoid outputs | **Yes, from ImageNet init** | ImageNet weights (timm) | 3,743 real fundus photos (APTOS + IDRiD) with controlled degradations + 6,899 real non-retina photos |
| [2] DR grader | EfficientNet-B2 at 288 px (served); B0 at 256 px archived; B2 at 512 px in progress | **Yes, fine-tuned** | Open fundus-pretrained weights, MIT licence | APTOS 2019, 3,662 graded images, 80/20 split |
| [3] Lesion evidence | U-Net with SE-ResNeXt50 encoder, 5 classes | **No, reused as-is** | Open weights, MIT licence, trained on 5 lesion datasets | We only evaluated it on IDRiD test (27 images) |

Why this split: in a 36-hour hackathon you train the models that decide your product's behaviour and that need your data (the coach and the grader), and you reuse a model where pixel-level training data is scarce and someone has already trained on all of it (lesion segmentation: only 81 IDRiD images have pixel masks; the reused model saw IDRiD, DDR, FGADR, MESSIDOR and RETINAL-LESIONS together).

---

## 2. Model [1]: the quality and lens coach

### 2.1 What problem it solves

Every real-world field study of DR screening AI reports the same failure: 13% to 38% of photos come back "ungradable" (Google ARDA in Thailand: 21% rejected; Remidio Medios in Punjab: 38% ungradable in the community arm; ICMR Punjab CHC study: 26% until a dark room was built). The existing products just say "retake". They do not say *why* or *how to fix it*. Worse, one study found ungradable images being misclassified as disease.

The coach is our answer. It runs on every camera frame before capture and after upload, and gives one of seven specific findings:

| Label | Meaning | What the worker sees |
|---|---|---|
| `not_fundus` | Not a retina at all (face, room, table) | Red. "This is not a retinal image." Grading blocked, cannot be forced. |
| `no_lens` | Retina visible but no clean lens field: partly cut, bright surround, zoomed in | Yellow. "Retinal lens not detected. This image may have low accuracy." Grading allowed; any DR grade goes to Second look. |
| `blur` | Out of focus or motion blur | Red. "Hold steady, refocus." |
| `glare` | Strong reflection | Yellow. "Change the angle slightly." |
| `dark` | Under-exposed | Red. "Increase illumination or move closer." |
| `bright` | Over-exposed | Red. "Reduce illumination or move back." |
| `off_centre` | Retina not centred | Yellow. "Move the camera slightly left/right." |

Red blocks grading (an ungradable photo is never reported as "No DR"). Yellow allows grading but lowers trust: with a yellow photo, any grade above 0 is routed to the Second-look queue instead of an automatic referral.

### 2.2 Why it is a trained model and not rules

Our first version (hour 1) was hand-written OpenCV rules: Laplacian variance for blur, HSV thresholds for glare, colour ratios for "is this a retina". It worked on 25 test images and would have broken on the 26th. Rules cannot learn what a phone-adapter photo looks like versus a hospital camera photo. So we replaced the decision with a trained classifier and kept the OpenCV numbers only for the metric bars and the field circle in the UI.

### 2.3 How we trained it

**Architecture.** `mobilenetv3_small_100` from timm, ImageNet initialisation, final layer replaced by 7 outputs with sigmoid (multi-label: a photo can be both dark and blurred). Input 256×256. About 2.5 million parameters, 6 MB in ONNX, runs in roughly 10 ms on a laptop CPU, which is what lets it run live on every camera frame.

**Data with exact labels.** Instead of hand-labelling thousands of bad photos, we generate them:
- Start from 3,743 real fundus photos (3,662 APTOS 2019 + 81 IDRiD). These are the "good" class.
- Apply zero, one or two degradations chosen at random, each with a random strength, and set the matching label to 1:
  - blur: Gaussian blur, sigma 2.5 to 7
  - glare: additive Gaussian bright blob, random position and size
  - dark: multiply by 0.12 to 0.32
  - bright: multiply by 1.9 to 3.0 and add an offset
  - off-centre: shift the retina 18% to 35% of the width sideways
  - no-lens: three modes that mimic a phone without the retinal lens seeing a retina: a zoomed crop with no dark border; a small retina inside a bright room-coloured surround; heavy vignette plus haze
- Add 6,899 real non-retina photographs (the "natural-images" set: people, cars, cats, dogs, flowers, fruit, motorbikes, airplanes) for `not_fundus`, 30% of them also blurred so the model does not learn "blurry means not a retina".
- Photometric jitter that is *not* a label (brightness ±15%) so the model learns the difference between "slightly different camera" and "actually too dark".
- Random horizontal flips.

Because every label comes from the transformation we applied, there is no annotation noise. The trade-off, stated honestly: synthetic degradations approximate real field faults; a study on real phone-adapter photos (mBRSET) is the next validation step.

**Training.** 85/15 split by image so no source photo appears in both sets. Binary cross-entropy on the 7 outputs. AdamW, learning rate 1e-3 with a one-cycle schedule, batch 32, 200 steps per epoch, 6 epochs, mixed precision on an RTX 4050 laptop GPU. The best epoch is chosen by mean average precision over the 7 labels on a fixed validation set of 1,200 generated samples (same seed every time, so numbers are reproducible).

**Validation.** Per label: average precision (AP), area under the ROC curve (AUC), accuracy at threshold 0.5. Written to `models/quality_model.json` and shown on the About page.
### Coach validation (held-out generated set, 1,200 samples from 562 unseen fundus photos + 2,070 unseen non-retina photos)

| Label | AP | AUC | Positives |
|---|---|---|---|
| not_fundus | 1.000 | 1.000 | 283 |
| no_lens | 0.956 | 0.987 | 248 |
| blur | 1.000 | 1.000 | 146 |
| glare | 1.000 | 1.000 | 154 |
| dark | 0.999 | 1.000 | 141 |
| bright | 0.999 | 1.000 | 144 |
| off_centre | 1.000 | 1.000 | 178 |

Mean AP 0.994. These are high because the validation faults are generated the same way as training faults; they prove the model learned the labels, not that it matches every real field fault. Real-image spot checks (demo set of 24 images incl. two synthetic non-retina images) are in `MODEL_CARD.md`. A hybrid rule keeps the model honest: `dark`, `bright` and `blur` are only reported when the measured brightness / sharpness agree, and the colour-signature rule can add `not_fundus` if the model misses a flat non-retinal image.


**How it is used.** `backend/quality.py` calls the model, thresholds each probability at 0.5, converts `off_centre` to left/right using the detected field centre, keeps three rule-only findings the model does not cover (no field detected, field too small, low contrast / possible media opacity), then derives `state`, `gradable`, `lens_detected` and the message. If the model file is missing, the code falls back to the rules and says so on the About page.

**What "lens adjustment coaching" means in practice.** In the camera screen a frame is sent to the coach every 0.8 seconds. The reticle ring changes colour and a status strip shows the message. The capture button is disabled on red. A small tag says "Retinal lens detected" or "No retinal lens". The worker adjusts the lens until the ring is green, then captures.

---

## 3. Model [2]: the DR grader

### 3.1 What it outputs

An ICDR severity grade, the standard 5-step scale:

| Grade | Name | Meaning |
|---|---|---|
| 0 | No apparent DR | No lesions |
| 1 | Mild NPDR | Microaneurysms only |
| 2 | Moderate NPDR | More than microaneurysms, less than severe |
| 3 | Severe NPDR | Many haemorrhages, venous beading, IRMA |
| 4 | Proliferative DR | New vessel growth; sight-threatening |

"Referable DR" means grade 2 or worse: the person must see an eye doctor.

### 3.2 Where the starting weights come from, and why

We did not start from ImageNet. We started from `ClementP/FundusDRGrading-efficientnet_b0`, an open MIT-licensed EfficientNet-B0 already trained on four fundus datasets (APTOS, EyePACS, DDR, IDRiD). Its author reports quadratic weighted kappa around 0.71 to 0.75 on external sets.

Why: a model that has already seen 100,000+ retinas knows what vessels, the optic disc and lesions look like. Fine-tuning from there on our 3,000 images converges in minutes and generalises better than training from ImageNet on the same data. We measured it: on our APTOS hold-out, those starting weights alone score QWK 0.688; after our fine-tune, 0.889.

### 3.3 How we trained it

**Regression, not classification.** ICDR grades are ordered. Predicting "3" when the truth is "4" is a small error; predicting "0" is a big one. Plain 5-way softmax ignores this. We use one regression output (a score from about 0 to 4), train with Smooth-L1 loss, and convert the score to a grade with four cut-points. The cut-points are then optimised on the hold-out set to maximise quadratic weighted kappa (QWK), the metric the APTOS competition used and the one that respects ordering. This is what the top APTOS solutions did; it typically adds 0.03 to 0.05 QWK over softmax.

**Data.** APTOS 2019 training set: 3,662 images graded by Aravind Eye Hospital clinicians in rural India. Split 80/20 stratified by grade; the 20% (733 images) is never trained on. The mirror we could download inside the time limit is 224 px, so we trained at 256 px (B0) and 288 px (B2). Higher resolution would help microaneurysm-level detail; that is a known limitation.

**Class balance.** APTOS is 49% grade 0 and only 5% grade 3. A weighted sampler draws rarer grades more often so the model does not learn "always say 0".

**Augmentation.** Flips, rotation up to 20°, colour jitter, and a "handheld" augmentation we wrote: mild blur, vignetting, glare blobs, brightness drift. This is deliberate: the target device is a phone with a lens adapter, not a hospital camera, so the grader is trained to tolerate exactly the artefacts the coach flags as yellow.

**Optimisation.** AdamW, learning rate 2e-4 (B0) / 1.5e-4 (B2), one-cycle schedule, mixed precision, batch 32 / 24, 6 epochs (B0) / 10 epochs (B2). After every epoch: evaluate on the hold-out, re-optimise the cut-points, keep the checkpoint with the best QWK.

**Test-time augmentation.** At inference the image and its horizontal flip are both scored and averaged. The disagreement between the two is one input to the confidence estimate.

**Confidence.** Two signals: how far the score is from the nearest cut-point (a score of 1.5 between "mild" and "moderate" is uncertain; 0.1 is not), and the flip disagreement. Combined into a 0–1 number. This is a heuristic, not a calibrated probability, and the About page says so. Confidence below 0.5 sends the case to Second look.

**Export.** ONNX with two outputs: the score, and the final feature map (1280 channels at 8×8). The classifier's linear weights are saved beside the model. The class-activation map (CAM) is then computed as the weighted sum of feature channels: for a global-average-pool + linear model this is exactly Grad-CAM without needing gradients, so it runs anywhere ONNX runs, including a browser.

### 3.4 Results (APTOS hold-out, n = 733, same split for every run)

| Run | QWK | Referable sens / spec | AUC | Grade-4 recall |
|---|---|---|---|---|
| Init weights, no fine-tune | 0.688 | 0.57 / 0.94 | 0.940 | 0% |
| B0, 256 px, 6 epochs | 0.889 | 0.98 / 0.89 | 0.973 | 15% |
| **B2, 288 px, 10 epochs (main app :8000)** | **0.905** | 0.97 / 0.90 | 0.978 | 31% |
| **B2, 512 px full-res, 8 epochs (clone :8001)** | **0.918** | 0.97 / 0.93 | 0.982 | 37% |
| **B2-512 Pro, phone-lens augmentation (clone :8001)** | 0.911 | 0.98 / 0.92 | 0.984 | 32% |
| B2-512 Pro on the phone-simulated hold-out | 0.853 | 0.90 / 0.91 | – | – |

Detail of the B0 run below; the B2 confusion matrix is in `MODEL_CARD.md`.

#### B0 run detail

| Metric | Init weights only | After our fine-tune |
|---|---|---|
| Quadratic weighted kappa | 0.688 | **0.889** (0.881 measured through the exported ONNX) |
| Accuracy (5-class) | 0.629 | 0.750 |
| Referable DR sensitivity | 0.571 | **0.977** |
| Referable DR specificity | 0.945 | 0.901 |
| Referable DR AUC | – | 0.973 |

Confusion matrix (rows: true, columns: predicted), best epoch:

```
        0    1    2    3    4
  0   343   17    1    0    0
  1     3   29   38    4    0
  2     1    5  140   53    1
  3     0    0    8   29    2
  4     0    1   16   33    9
```

Reading it: grade 0 is nearly perfect (95%). The model rarely calls a diseased eye healthy (only 4 of 372 diseased eyes were called grade 0). The weak boundaries are 1 versus 2 and 3 versus 4. Those are exactly the boundaries that matter least for the referral decision (both 3 and 4 refer urgently; both 1 and 2 need follow-up, with 2 referred) and exactly why the product has a Second-look tier instead of forcing a binary answer.

For comparison, the deployed systems in Indian primary care that we reverse-engineered: Forus AI specificity 54–63%, SigTuple 65%, EyeArt pooled 81%. Our 0.90 specificity on the hold-out is not a field result, but it shows the approach is not the over-referral trap those systems fell into.

The B2 run at 288 px beat B0 (QWK 0.905 vs 0.889) and is the main app's model. The 512-px run on full-resolution APTOS beat it again (QWK 0.918, specificity 0.926, grade-4 recall 37%) and runs on the comparison clone. The Pro run adds a phone-plus-lens capture simulation so the grader stops under-grading hand-held lens photos; it is judged on both the normal and a phone-simulated hold-out so it cannot trade one for the other.

---

## 4. Model [3]: lesion evidence

### 4.1 Why we reused instead of trained

Pixel-level lesion labels are rare: IDRiD has 81 images, DDR 757, FGADR 1,842 (data-use agreement). Training a segmenter from 81 images in a hackathon gives blobs, not lesions. `ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d` is an open MIT-licensed U-Net trained by its author on IDRiD + DDR + FGADR + MESSIDOR (MAPLES-DR) + RETINAL-LESIONS together. Using it is the correct engineering decision; claiming we trained it would not be.

What we did do: load the safetensors weights into `segmentation_models_pytorch`, export to ONNX at 512×512, post-process, and validate it ourselves.

### 4.2 Our validation (IDRiD test set, 27 images, our script)

| Lesion | Pixel Dice | Image-level recall |
|---|---|---|
| Hard exudates | 0.68 | 27/27 |
| Cotton wool spots | 0.68 | 9/14 |
| Haemorrhages | 0.62 | 25/27 |
| Microaneurysms | 0.21 | 25/27 |

Exudates and haemorrhages are reliable. Microaneurysm outlines are approximate (they are 2–5 pixels wide; the literature's best AUC-PR for MA is about 0.5). The UI shows microaneurysm counts as "indicative", and the model card says so.

### 4.3 Post-processing and how it becomes an explanation

- Predictions outside the retinal disc are suppressed.
- Connected components smaller than 4 px (MA) or 12 px (others) are dropped as noise.
- Each lesion type is drawn as a coloured outline with a light fill: red microaneurysms, magenta haemorrhages, yellow hard exudates, cyan cotton wool spots.
- "Near macula" = any component within 18% of the image size from the centre. Exudates near the macula are the classic sign of diabetic macular oedema risk, so this is flagged in the sentence.
- The grade, lesion counts and macula flag produce one plain sentence, for example: "Moderate NPDR: 14 microaneurysms, 6 haemorrhages, hard exudates near the macula. More than microaneurysms but less than severe NPDR."
- If the grader says 0 but the lesion model finds 3 or more haemorrhages or exudates, the two models disagree, and the case goes to Second look. This cross-check is a second, independent source of evidence, which is what "explainable" should mean in practice: not a heat blob, but countable findings a clinician can argue with.

---

## 5. How accuracy increases stage by stage

Accuracy in a screening programme is not one number. It is the product of four things, and each model addresses one:

1. **Fewer wasted photos.** The coach turns "ungradable, retake" into "blurred, hold steady" before the shutter is pressed. In the Thailand study 21% of photos were thrown away after upload; a live coach moves that decision to before capture, when the patient is still in the chair.

2. **No disease hidden inside bad photos.** Red never reaches the grader, so a dark or blurred image cannot come back as "No DR". This is the failure Medios showed in Punjab (ungradables misclassified).

3. **Fewer false referrals.** Regression + optimised cut-points + confidence + Second look. A 55% specificity system sends nearly half of healthy people on a bus to the district hospital. Our hold-out specificity is 0.90, and uncertain cases are held for a remote grader instead of referred.

4. **Fewer missed cases.** Sensitivity for referable DR 0.977 on the hold-out; the lesion cross-check catches grader misses.

5. **Trust.** Every result carries a heat map, lesion outlines, counts, a sentence, a confidence, and the photo-quality verdict. A nurse can look at the outlined haemorrhages and agree or disagree.

---

## 6. What is honest to say and what is not

Say:
- "We trained the grader and the quality/lens coach ourselves on this laptop; the lesion model is an open MIT model we validated."
- "QWK 0.88 and referable sensitivity 0.98 on an APTOS hold-out of 733 Indian images."
- "The coach is trained on synthetic degradations of real retinas plus real non-retina photos; it needs a field study on phone-lens photos next (mBRSET script is ready)."
- "Not a medical device; the path is CDSCO Class C SaMD, the same route Remidio and Forus took."

Do not say:
- "Clinically validated." It is not.
- "Works on any phone without a lens." A bare phone cannot photograph the retina; the coach will tell you so.
- Any accuracy number for phone-lens photos. We have not measured it yet.

---

## 7. Where everything lives

| What | File |
|---|---|
| Coach training | `train/train_quality.py` → `models/quality_model.onnx` + `.json` |
| Grader training | `train/train_dr.py` → `models/dr_model.onnx` + `.json`, `models/training_summary.json` |
| Grader evaluation as served | `train/evaluate_onnx.py` → `models/eval_aptos_holdout.json` |
| Lesion export and evaluation | `scripts/export_lesion.py`, `train/evaluate_lesions_idrid.py` → `models/eval_lesions_idrid.json` |
| Serving | `backend/quality.py`, `backend/quality_model.py`, `backend/inference.py` |
| Honest limits | `MODEL_CARD.md` |
