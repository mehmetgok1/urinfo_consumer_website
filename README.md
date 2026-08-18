# Urinfo Consumer Website

React single-page app for athletes and coaches.

## Tech Stack

- React (Vite)
- AWS Amplify (`aws-amplify` + `@aws-amplify/ui-react`)
- Tailwind CSS
- QR generation (`qrcode.react`)
- QR scanning (`html5-qrcode`)

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

## AWS Configuration

Create a `.env` file in the project root with the following values:

```bash
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxx
VITE_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COACH_LINK_API_URL=https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/coaches/link
```

Notes:

- `VITE_COACH_LINK_API_URL` should point to your authenticated `POST /coaches/link` API Gateway endpoint.
- Ensure Cognito groups are named `users` and `coaches`.

## Cognito Groups and Role Routing

After sign-in, the app inspects the `cognito:groups` claim from the ID token:

- `coaches` -> coach scanner dashboard
- `users` (or no coach group) -> athlete QR dashboard

## API Call from Coach View

When a coach scans an athlete QR code, the app sends:

- Header: `Authorization: Bearer <access_token>`
- Body: `{ "CoachId": "<coach_sub>", "UserId": "<scanned_sub>" }`

to:

- `VITE_COACH_LINK_API_URL`
