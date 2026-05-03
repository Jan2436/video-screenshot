# Video Screenshot Extension

A browser extension to control video playback speed and capture high-quality screenshots from HTML5 videos and Douyin (TikTok) photo mode.

## Features

*   **Video Speed Control:** Adjust playback speed from 0.1x to 3.0x using a slider or preset buttons.
*   **Video Screenshot:** Capture the current frame of any playing HTML5 video.
*   **Douyin Photo Mode Support:** Extracts and downloads the current active high-resolution image from Douyin's photo/image mode.
*   **Floating Panel:** A convenient draggable and resizable panel to control speed and take screenshots.
*   **Keyboard Shortcut:** Press `Shift + S` to quickly capture a screenshot of the current video or image.
*   **Smart Detection:** Automatically finds the most prominent video or image in the viewport for accurate capturing.

## Installation

1. Clone or download this repository.
2. Open your Chromium-based browser (Chrome, Edge, etc.) and go to the extensions page (e.g., `chrome://extensions/`).
3. Enable "Developer mode".
4. Click "Load unpacked" and select the directory containing the extension files.

## Usage

*   Click the extension icon in the toolbar to toggle the floating control panel.
*   Use the slider or preset buttons in the panel to change video speed.
*   Click the "截取当前帧" (Capture Current Frame) button in the panel or press `Shift + S` to save a screenshot.
*   You can choose between PNG, JPEG, and WebP formats in the panel.

## Recent Updates

*   **Fixed:** Improved target selection for screenshots on Douyin, ensuring the current visible video is captured rather than the next off-screen video.
*   **Enhanced:** Re-wrote Douyin photo mode detection to robustly identify and capture the currently viewed image by analyzing viewport position and element dimensions.

## License

MIT License