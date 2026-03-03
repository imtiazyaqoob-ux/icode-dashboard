#!/bin/bash
cd "$(dirname "$0")"
echo "Starting iCode Glen Ellyn Dashboard..."
echo "Opening http://localhost:3000 in your browser..."
sleep 1
open http://localhost:3000
node server.js
