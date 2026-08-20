#!/usr/bin/env bash
# Launch Casper Browser against your local LM Studio.
set -e

echo ""
echo -e "  \033[36mCasper Browser - launch\033[0m"
echo -e "  \033[36m========================\033[0m"
echo ""

# 1) Node.js present?
if ! command -v node >/dev/null 2>&1; then
  echo -e "  \033[31m[!!] Node.js not found. Install from https://nodejs.org (LTS) then re-run.\033[0m"
  exit 1
fi
echo -e "  \033[32m[ok] Node.js $(node -v)\033[0m"

# 2) Is LM Studio's local server up?
LM="http://127.0.0.1:1234"
if models_json=$(curl -sf --max-time 3 "$LM/v1/models" 2>/dev/null); then
  models=$(echo "$models_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);((j.data||[]).map(m=>m.id)).forEach(m=>console.log('       - '+m))}catch(e){console.log('       (could not parse model list)')}})")
  if [ -n "$models" ]; then
    echo -e "  \033[32m[ok] LM Studio reachable - models:\033[0m"
    echo "$models"
  else
    echo -e "  \033[33m[!] LM Studio is up but no model is loaded. Load a chat model in LM Studio.\033[0m"
  fi
else
  echo -e "  \033[33m[!] LM Studio not reachable at $LM\033[0m"
  echo -e "      \033[33mStart it: LM Studio -> Local Server tab -> Start Server -> load a model.\033[0m"
  echo -e "      \033[90m(Casper will run in demo mode until then.)\033[0m"
fi

# 3) Install deps if needed
if [ ! -d node_modules ]; then
  echo -e "  \033[36m[..] Installing dependencies (first run)...\033[0m"
  npm install
fi

# 4) Launch
echo -e "  \033[36m[..] Launching Casper Browser...\033[0m"
echo ""
npm run electron
