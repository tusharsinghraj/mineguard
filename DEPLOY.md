# MineGuard — Deploy with Firebase + GitHub + Render

## 1. Firebase (database)
1. https://console.firebase.google.com → Add project.
2. Build → Firestore Database → Create database → Production mode → pick a region.
3. Firestore → Rules → set `allow read, write: if false;` and Publish.
   (The server uses the Admin SDK, which bypasses rules, so nobody can read the DB from a browser.)
4. Project settings (gear) → Service accounts → Generate new private key → downloads a .json file.
5. Convert it to one line of base64:
   - Mac/Linux: `base64 -w0 key.json`   (Mac: `base64 -i key.json`)
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`
6. NEVER commit key.json to GitHub.

Photos are compressed in the browser and stored inside Firestore (no Blaze plan/card needed).

## 2. GitHub
```bash
cd MineGuard_App
git init
git add .
git commit -m "MineGuard"
git branch -M main
git remote add origin https://github.com/<your-username>/mineguard.git
git push -u origin main
```
(Create the empty repo `mineguard` on github.com first.)

## 3. Render
1. https://render.com → New → Blueprint (uses render.yaml) or New → Web Service.
2. Connect the GitHub repo.
3. Fill in the environment variables:
   - SUPERVISOR_EMAIL / SUPERVISOR_PASSWORD (min 10 chars)
   - WORKER_EMAIL / WORKER_PASSWORD (min 10 chars)
   - FIREBASE_SERVICE_ACCOUNT_BASE64 = the base64 string from step 1.5
   - (NODE_ENV=production, DEMO_MODE=false and SESSION_SECRET are preset by render.yaml)
4. Deploy. Open the https://….onrender.com link and log in.

Data, accounts, photos and login sessions now live in Firestore, so redeploys/restarts do not erase anything.
To delete data: Firebase Console → Firestore → delete documents in `incidents`, `photos`, `users`.
Free Render sleeps after 15 min idle; first load afterwards takes ~30-50 s.
