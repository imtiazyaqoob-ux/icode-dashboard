# iCode Glen Ellyn Dashboard

## Setup (One Time)

1. Install Node.js from https://nodejs.org (choose the LTS version)
2. Unzip this folder somewhere on your computer

## Running the Dashboard

### Mac / Linux:
Double-click `start-mac.command`  
OR open Terminal in this folder and run: `node server.js`

### Windows:
Double-click `start-windows.bat`  
OR open Command Prompt in this folder and run: `node server.js`

Then open your browser and go to: **http://localhost:3000**

## Stopping
Press `Ctrl + C` in the terminal window.

## Troubleshooting
- Make sure Node.js is installed: run `node --version` in a terminal
- If port 3000 is in use, edit server.js and change `const PORT = 3000` to another number like 3001
