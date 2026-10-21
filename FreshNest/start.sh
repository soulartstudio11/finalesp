```bash
#!/usr/bin/env bash

# Stop if a command fails
set -e

# Move to the server directory relative to this script
cd "$(dirname "$0")/server"

# Install packages on the first run
if [ ! -d "node_modules" ]; then
    echo "First-time setup: installing FreshNest server packages..."
    npm install
fi

echo ""
echo "Starting FreshNest website and API..."
echo "Open http://localhost:3000 in your browser."
echo "Keep this terminal open while using FreshNest."
echo "Press Ctrl+C to stop the server."
echo ""

npm start
```
