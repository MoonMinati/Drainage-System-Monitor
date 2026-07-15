# Smart Drainage Monitor

A Vite + React dashboard for monitoring drainage water levels, simulating storm events, and controlling a pump or gate through Web Bluetooth.

## Features

- Live water-level dashboard with threshold, status, and history chart
- Manual and smart automatic pump control with hysteresis
- Built-in simulator for demos without hardware
- Web Bluetooth support for HM-10 / CC2541 serial modules, Nordic UART Service, or custom GATT UUIDs
- Arduino sketch and wiring reference inside the app
- Responsive UI for desktop and mobile operation

## Run Locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Web Bluetooth requires Chrome or Edge on HTTPS or `localhost`.

## Hardware Protocol

The Arduino should transmit newline-terminated frames:

```text
distance,status
24.8,OFF
```

The dashboard sends pump commands as:

```text
ON
OFF
```

## Scripts

- `npm run dev` starts the local development server.
- `npm run lint` runs TypeScript checks.
- `npm run build` creates the production bundle.
- `npm run preview` serves the production build locally.
