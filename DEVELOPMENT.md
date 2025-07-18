# Development

## Environment setup

1. Clone or download the source code from this repository.

2. Install [Node.js](https://nodejs.org).

3. Enter the project root and install dependicies:
   ```
   npm install
   ```

## Install and test in the browser

1. Prepare development for the browser:
   ```
   npm run dev:chromium
   ```
   or
   ```
   npm run dev:firefox
   ```

2. Open the browser, enter the `Extensions` manager, enable `Developer mode`, and click `Load unpacked` and load the `src` directory to install the extension.

## Build extension package(s)

Enter the project root and run:
```
npm run pack
```

Built files will be available in `dist`.
