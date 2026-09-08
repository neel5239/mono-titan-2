# RetinaEdge — live demo script (Team MonoTitan, IIC 3.0, Problem Statement 12)

Target length: 6 minutes talk + demo, 2 minutes questions. One presenter speaks, one drives the laptop. Words in **bold** are the lines to say. Actions in `code` are what the driver does. Keep the phone in airplane mode the whole time and say so.

Before you start (5 minutes before slot):
- Laptop: `python D:/retinaedge/run.py --host 0.0.0.0` running, browser on http://localhost:8000, dark theme, English UI.
- Phone on the same Wi-Fi with http://<laptop-ip>:8000 open, then Wi-Fi off and airplane mode on (the page stays cached; if the phone was not pre-loaded, demo from the laptop only).
- Demo images open in a folder: `D:\retinaedge\samples\demo_fullres\` (real APTOS + IDRiD photos, true grade in the filename), `samples\fake_face.jpg`, `samples\demo\bad_blur.jpg`, `samples\demo\bad_glare.jpg`, `samples\sim_handheld_lens.jpg`.
- Records already contain 3–4 saved screenings so the Dashboard is not empty.
- Slides open on the second screen; deck: `RetinaEdge_MonoTitan_IIC3_v3.pptx`.

---

## 0:00 — Opening (slide 1, 20 s)

**"We are MonoTitan. Problem statement 12: explainable AI for diabetic retinopathy screening in rural India. Our answer is RetinaEdge, and everything you will see runs with the internet switched off."**

`Driver holds up the phone showing airplane mode.`

---

## 0:20 — The problem (slide 2 left side, 60 s)

**"India has over 100 million people with diabetes and about 20,000 eye doctors, almost all in cities. Diabetic retinopathy is silent until it is too late, and it is preventable if caught early. Screening means a photo of the back of the eye, read by a doctor. In a village there is no doctor to read it."**

**"AI for this already exists. Google, Eyenuk, Remidio, Forus. In the lab they are all above 90% accurate. In the field they fail the same three ways:"**

- **"One. Between 13 and 38 percent of photos come back 'ungradable'. The AI says 'retake' and nothing else. In Punjab one system marked those bad photos as disease."**
- **"Two. The answer is a black-box yes or no. Nurses and doctors do not trust it, patients do not understand it."**
- **"Three. They need internet and a camera costing 4 to 55 lakh rupees."**

**"And when they do work, some deployed systems in Indian primary care sent 40 percent of healthy people to the district hospital. That is a bus ride, a lost day of wages, and a clogged eye department."**

---

## 1:20 — The solution in one sentence (slide 2 right side, 20 s)

**"RetinaEdge takes one retina photo and gives the health worker four things: a photo coach that fixes the picture before it is taken, a grade with the lesions drawn on the image so anyone can see why, a clear next step for the patient in their own language, and it does all this offline on a ten-thousand-rupee phone."**

---

## 1:40 — LIVE DEMO part 1: the photo coach (90 s)

`Driver: Home → New screening. Step 1: type patient name "Demo Patient", age 54, eye Right, site "Demo PHC", report language Hindi. Next.`

**"Step one is the patient. Everything optional except the eye, because the worker has 5 minutes per person."**

`Step 2: click Use camera on the laptop. Point the webcam at the presenter's face.`

**"Step two is the photo. Watch the ring. This is the live coach. Every frame goes through a model we trained. Right now it sees my face."**

`Ring turns red; status reads "This is not a retinal image".`

**"Red. 'Not a retinal image.' The capture button is disabled. It cannot be forced. This is how we stop garbage from ever reaching the grader."**

`Close camera. Drag in samples\demo\bad_blur.jpg.`

**"Now a real retina, but blurred. Red again, and it says why: 'Image is blurred, hold steady, refocus'. Not 'retake'. A specific instruction."**

`Drag in samples\demo\bad_glare.jpg.`

**"Glare from the lens. Yellow: usable, but it warns. If the glare sat on the centre of the retina it would be red. The coach knows seven faults: not a retina, no lens, blur, glare, too dark, over-exposed, off-centre."**

`Drag in samples\sim_handheld_lens.jpg.`

**"This is what a phone with a hand-held lens produces: skin, a metal rim, a small retina with colour fringes. Our localiser finds the retina, crops it, and the coach still grades the picture. If the lens is missing it tells you the result may be low accuracy."**

---

## 3:10 — LIVE DEMO part 2: grade with evidence (90 s)

`Drag in samples\demo_fullres\aptos_grade2_0_<id>.png (true grade: Moderate). Green. Click Analyse.`

**"A good photo. Green. Analyse."**

`Result appears in about a second.`

**"Moderate NPDR, confidence 83 percent. Now the part that makes this explainable. These outlines are the lesions our second model found: red for microaneurysms, magenta for haemorrhages, yellow for hard exudates. Tap the legend to hide and show each type. The heat map shows where the grader looked. And here is the sentence a nurse can read out: 'Moderate NPDR: 14 microaneurysms, 6 haemorrhages, hard exudates near the macula.'"**

`Point at the tier pill.`

**"Decision: Refer. Eye department within four weeks. Four tiers in total: routine, recheck in six months, refer, refer urgently, plus a fifth path called Second look. When the model is unsure, or the grader and the lesion model disagree, the case goes to a remote grader instead of a bus."**

`Click Save record. Step 4: the patient sheet appears in Hindi.`

**"Step four. The patient sheet in Hindi, with pictures, the follow-up date, and a QR code the hospital can scan. Print, or share on WhatsApp."**

`Click Print to show the print preview, then cancel.`

---

## 4:40 — The numbers (slide 2 right column and slide 6, 40 s)

**"Everything you saw is trained and validated by us on this laptop, on 733 held-out Indian retina images the model never saw:"**

- **"Referable disease detected 97 percent of the time."**
- **"Healthy eyes called healthy 93 percent of the time. Compare 54 to 65 percent for AIs measured in Punjab primary care."**
- **"Quadratic weighted kappa 0.91. Top single models in the APTOS competition score 0.90 to 0.93."**
- **"The photo coach scores 0.99 mean average precision across its seven faults."**

**"And it costs under 15 rupees per screening. Kerala's state programme costs 2,129 rupees per person."**

---

## 5:20 — Dashboard and honesty (40 s)

`Open Dashboard.`

**"The district officer sees this: how many screened, the ungradable rate per site, and this chart, 'why photos fail', which nobody else gives them. This is how you fix a screening programme: you find out that one PHC needs a dark room."**

**"What we have not done: no clinical trial yet. Phone-lens photos are harder than hospital-camera photos, and we are training a version right now that simulates them. Confidence is a heuristic, not a calibrated probability. The path to real use is CDSCO Class C software-as-a-medical-device, the same route Remidio and Forus took."**

---

## 6:00 — Close (slide 6, 15 s)

**"Nobody in this space runs offline in a browser, coaches the photo, detects a missing lens, shows the lesions behind the grade, and sends uncertain cases to a human. RetinaEdge does all five. Thank you."**

---

## Likely questions and answers

**"Where is the camera?"**
"Any fundus camera export, or an 8,000-rupee 20D lens on a phone. The software is camera-agnostic; that is the point. The lens adapter is the next hardware step; the app already has live camera capture built for it."

**"Is this clinically validated?"**
"No. It is a working prototype validated on public datasets with a fixed hold-out. The next step is an external test on mBRSET, a public dataset of handheld phone-camera retina photos, then a prospective study."

**"How is this different from Remidio Medios, which is also offline?"**
"Medios needs a 4.25-lakh Remidio camera and gives a binary answer; in its Punjab trial 38 percent of community photos were ungradable. We run on any phone or laptop, give a five-level grade with lesion evidence, and coach the photo before it is taken."

**"Why not just a heat map?"**
"A 2019 study in Ophthalmology showed heat maps made doctors worse on healthy eyes. Lesion outlines and counts map to how ICDR grades are defined, so a clinician can argue with them."

**"What did you train yourselves?"**
"The DR grader, fine-tuned on APTOS 2019 from open MIT weights, and the photo and lens coach, trained from scratch on real retinas with controlled degradations plus real non-retina photos. The lesion segmenter is an open MIT model we validated on IDRiD. All of that is written in our model card."

**"What happens when the model is wrong?"**
"Its errors are one grade up or down. Grade 3 called grade 4 is still 'refer urgently'. Grade 1 called grade 2 is over-cautious. Four out of 372 diseased eyes in the hold-out were called healthy; the lesion cross-check and the second-look tier are there to catch those."

**"Can it run on the phone without the laptop?"**
"Today the models run on the laptop and the phone talks to it over local Wi-Fi with no internet. The models are exported to ONNX, which runs in a browser; on-device inference is the next step and needs no retraining."

---

## Fallbacks

- Camera blocked or no webcam: skip the face test; drag in `samples\fake_face.jpg` instead. Same red result.
- Server not responding: the app shows "Server not running"; restart with `python D:/retinaedge/run.py --host 0.0.0.0` (10 seconds).
- Projector kills the dark theme: switch to Light in the header; everything is designed for both.
- If asked to compare models: http://localhost:8001 runs the higher-resolution 512-px grader side by side; same UI.
