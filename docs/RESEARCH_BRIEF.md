# RetinaEdge research brief: what the literature says, where the market is, where the gap is, what we built

One-page reading for the team. Every claim below comes from a peer-reviewed paper or a regulatory/field report; links in the last section.

## What this is, in one line
AI that reads a retina photo for diabetic retinopathy (DR), the leading preventable cause of blindness in working-age adults, so that a health worker in a village can screen without an eye doctor present. Our version adds what the field studies say is missing: photo coaching, lens detection, lesion-level evidence, and offline use.

## The three papers that matter most

**1. Gulshan et al., JAMA 2016 (Google). "Development and validation of a deep learning algorithm for detection of diabetic retinopathy in retinal fundus photographs."**
- What: Inception CNN trained on ~128,000 EyePACS images graded by 54 ophthalmologists; binary referable-DR output.
- Result: AUC 0.99 on EyePACS-1 and Messidor-2; sensitivity 97.5% / specificity 93.4% at the high-sensitivity operating point.
- Why it matters: proved the accuracy problem is solvable. Every commercial product since is a descendant.
- Limit the paper itself admits: retrospective, single clean camera type, no clinical-outcome evaluation. It did not test what happens in a real clinic.

**2. Beede et al., ACM CHI 2020 (Google). "A human-centered evaluation of a deep learning system deployed in clinics for the detection of diabetic retinopathy."**
- What: the same Google algorithm deployed prospectively in 11 clinics in Thailand, studied by observing nurses and patients.
- Result: about 21% of nurse-captured images were rejected as ungradable (poor lighting, no dilation); slow uploads; only ~10 patients per 2-hour session; nurses frustrated; patients referred to distant hospitals because of image quality rather than disease.
- Why it matters: the first honest account that the deployment problem, not the model, decides whether screening works. Directly motivates our live quality coach and offline design.

**3. Sayres et al., Ophthalmology 2019 (Google). "Using a deep learning algorithm and integrated gradients explanation to assist grading for diabetic retinopathy."**
- What: reader study with 10 ophthalmologists reading 1,796 images unassisted, with the AI grade, and with the AI grade plus a heat map.
- Result: grades improved accuracy; heat maps helped on diseased eyes but reduced accuracy on healthy eyes and increased reading time.
- Why it matters: "explainable" cannot mean a heat blob. Explanations must be lesion-level and countable. That is why we outline and count lesions and show the heat map only as a secondary view.

Honourable mentions: Ting et al., JAMA 2017 (first multi-ethnic external validation; showed performance shifts across cameras and populations); Abràmoff et al., npj Digital Medicine 2018 (IDx-DR, first FDA-authorised autonomous AI; real-world undilated gradability later found to be only 49–75%); RETFound, Nature 2023 (retinal foundation model; label-efficient fine-tuning).

## What the market is doing (and how it fails in India)

| Product | Status | What happens in the field |
|---|---|---|
| Google ARDA (licensed to Forus, AuroLab) | CE; India licensees since 2024 | India post-deployment 2025: 86.9% gradable; Thailand: 21% rejected, workflow failure |
| Remidio Medios | CDSCO-cleared 2024, offline on iPhone with ₹4.25-lakh Remidio camera | Punjab BMJ Open 2026: 38% ungradable in community arm; ungradable images misclassified as DR; binary output only |
| Forus FH-POISE | CDSCO Class C 2026, own 3nethra cameras | Punjab PHC study, IJO 2026: specificity 54–63%, shifts between cameras |
| SigTuple, Netra.AI (Leben Care) | cloud, not CDSCO-cleared for DR | Punjab CHC JMIR 2025: sensitivity 99.6% but specificity 64.7% |
| Eyenuk EyeArt, LumineticsCore, AEYE | FDA-cleared, US-centred | cloud, desktop cameras, no lesion explanation, 2.2% real-world uptake in the US |

Pattern: high sensitivity in the lab, then in Indian primary care 13–38% ungradable images, specificity collapsing to 54–65% (healthy people sent to hospital), black-box output, expensive locked hardware, internet required.

## Datasets: what exists, what is missing
- Public and used by everyone: APTOS 2019 (3,662 Indian images, 5 grades), EyePACS 2015 (88,702, noisy labels), Messidor-2 (1,748), IDRiD (516, 81 with pixel lesion masks), DDR (13,673), DeepDRiD (quality labels), RFMiD (46 diseases, India), BRSET / mBRSET (Brazil; mBRSET is the first public handheld phone-camera DR set, 5,164 images).
- Missing: a public Indian phone-plus-lens DR dataset with grades and quality labels. Remidio's field sets are proprietary. This is why every academic on-device paper validates only on hospital-camera images.
- Lesion-level labels are scarce (IDRiD 81, DDR 757, FGADR 1,842 under agreement), which is why we reuse an open segmenter trained on all of them rather than training one on 81 images.

## The research gap, stated by the literature itself
1. Real-world gradability is the dominant failure and is unsolved upstream; quality models are camera-specific and only reject, they do not coach.
2. Domain shift across cameras, fields and phone adapters (GDRBench shows large drops leave-one-domain-out); handheld images barely exist in training data.
3. Explainability clinicians trust: saliency maps are unfaithful (Ayhan 2022, Saporta 2022) and can harm (Sayres 2019); lesion / concept explanations are promising but starved of labels.
4. Uncertainty-based deferral improves accuracy offline (Leibig 2017, Ayhan 2020) but has never been wired into a referral workflow.
5. No on-device system combines quality gate + uncertainty + explanation + external validation (2025 survey "From Retinal Pixels to Patients").

## What we built against each gap (research and development done here)
- Gap 1: a trained quality-and-lens coach (MobileNetV3, 7 faults) that runs on every live frame and says what to fix; central glare and non-retina images are hard-rejected; generated labels from real retinas so every label is exact. Mean AP 0.99 on a held-out generated set.
- Gap 2: full-resolution training (512 px) plus a phone-plus-lens capture simulation (ring, glare, haze, colour cast, edge fringing, non-black surround, low resolution, JPEG); a retina localiser that crops the disc out of skin, rim and room; phone-simulated hold-out reported alongside the normal one. Sensitivity on phone-simulated photos rose from 68.5% to 90.6% during the Pro run while normal-photo results held.
- Gap 3: lesion outlines and counts (microaneurysms, haemorrhages, exudates, cotton wool spots), "near macula" flag, one plain sentence tied to ICDR definitions; heat map secondary. Lesion model validated on IDRiD test (Dice 0.69 / 0.62 / 0.21).
- Gap 4: confidence from cut-point distance and flip-TTA disagreement; grader-versus-lesion disagreement; both route to a Second-look queue for a remote grader instead of forcing yes/no. Hold-out specificity 90–93% versus 54–65% measured for deployed field AIs.
- Gap 5: everything runs offline in a browser-served app on a laptop or phone; ONNX models; dashboard reports the ungradable rate and why photos fail, which no vendor exposes.
- Grader: EfficientNet-B2 fine-tuned from open MIT fundus weights on APTOS 2019, regression with QWK-optimised cut-points. Hold-out (733 images): sensitivity 96.6–97.3%, specificity 90.3–92.6%, AUC 0.98, QWK 0.90–0.91.

## Where research says to go next, and how we would do it
- External validation on real phone-lens photos: run our evaluation script on mBRSET (PhysioNet access pending), then a small prospective collection with a ₹8k 20D adapter at one PHC. Report gradability rate as the headline number, as the Thailand and Punjab papers do.
- Calibrated uncertainty: replace the heuristic confidence with conformal prediction or temperature scaling on the hold-out, then measure accuracy-versus-coverage of the second-look tier.
- Reader study in the Sayres design: nurses grading with lesion outlines versus heat maps versus nothing, to prove the explanation helps rather than harms.
- Distil a retinal foundation model (RETFound-Green) into the edge grader to improve the grade 1-vs-2 and 3-vs-4 boundaries without a bigger model.
- Regulatory path: CDSCO Class C software-as-a-medical-device, the route Remidio (2024) and Forus (2026) took; ICMR pragmatic-trial design already published for Punjab can be reused.

## Sources
- Gulshan et al. 2016: https://jamanetwork.com/journals/jama/fullarticle/2588763
- Beede et al. 2020: https://dl.acm.org/doi/10.1145/3313831.3376718
- Sayres et al. 2019: https://www.aaojournal.org/article/S0161-6420(18)31575-6/fulltext
- Ting et al. 2017: https://pmc.ncbi.nlm.nih.gov/articles/PMC5820739/
- Abràmoff et al. 2018: https://www.nature.com/articles/s41746-018-0040-6
- RETFound 2023: https://www.nature.com/articles/s41586-023-06555-x
- ARDA India 2025: https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2831702
- Remidio Medios trial 2026: https://pmc.ncbi.nlm.nih.gov/articles/PMC13007179/
- Punjab multi-algorithm study 2026: https://pubmed.ncbi.nlm.nih.gov/42330215/
- Punjab CHC implementation 2025: https://pmc.ncbi.nlm.nih.gov/articles/PMC12419978/
- Ayhan et al. 2022 saliency validation: https://www.sciencedirect.com/science/article/abs/pii/S1361841522000172
- Survey 2016–2025: https://arxiv.org/abs/2511.11065
- GDRBench: https://github.com/chehx/DGDR/blob/main/GDRBench/README.md
- mBRSET: https://physionet.org/content/mbrset/
- Kerala cost study 2024: https://www.nature.com/articles/s41433-024-03304-w
