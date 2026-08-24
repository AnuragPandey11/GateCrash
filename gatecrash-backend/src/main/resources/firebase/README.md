# Firebase service account

Place the Firebase Admin SDK service-account JSON here as `service-account.json` to enable push
notifications locally, or point `FIREBASE_CREDENTIALS` at a different path/`classpath:` resource.

This file is **never committed** — see `.gitignore`. With `app.firebase.enabled=false` (the local/test
default), `FcmService` logs what it would have sent instead of contacting Firebase, so this directory
can stay empty for day-to-day development.
