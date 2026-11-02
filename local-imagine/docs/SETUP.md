# セットアップ (Mac M1 / Apple Silicon)

対象: macOS 14 以降の Apple Silicon Mac。16GB 推奨。8GB でも SD1.5 なら動きます。

## 0. 前提ツール

```bash
xcode-select --install                    # Command Line Tools
brew install git python@3.12 node         # Homebrew が無ければ https://brew.sh
```

## 1. Ollama (ローカル LLM)

1. https://ollama.com/download からインストール (または `brew install --cask ollama`)。
2. モデルを取得 (詳しくは [MODELS.md](MODELS.md)):

   ```bash
   ollama pull qwen3.5:9b        # 16GB: チャット + ツール + 画像認識 (約 6.6GB)
   ollama pull qwen3.5:4b        # 8GB 向け (約 3.4GB)
   # NSFW のプロンプトを書かせたい場合はコミュニティの "abliterated" 版 (例)
   ollama pull huihui_ai/qwen3-vl-abliterated:8b
   ```

3. 動作確認: `curl http://127.0.0.1:11434/api/version`

メニューバーの Ollama アプリが動いていれば `ollama serve` は不要です。
アプリは **サーバー側 (Next.js の route handler) から** Ollama を呼ぶため、CORS 設定は不要です。

### メモリについての注意

LLM と画像モデルは同じユニファイドメモリを取り合います。

| Mac | LLM の目安 | 設定 → "LLM の keep_alive" |
| --- | --- | --- |
| 8GB | 2B–4B (q4) | `0` (返答後すぐ解放) を推奨 |
| 16GB | 4B–9B (q4) | `5m` (既定) で問題なし。SDXL + 9B が苦しければ `0` |

Ollama の既定コンテキストは 24GB 未満の Mac で 4096 トークンです。アプリは `num_ctx` を明示的に渡します (設定で変更可。既定 8192)。

## 2. ComfyUI (画像生成)

### A. スクリプトで入れる (推奨・開発者向け)

```bash
cd local-imagine
bash scripts/setup-comfyui.sh            # ../ComfyUI に clone、venv 作成、PyTorch(MPS) と必要ノードを導入
```

入るもの: ComfyUI 本体、ComfyUI-Manager、ComfyUI_IPAdapter_plus (参照画像)、
ComfyUI-VideoHelperSuite と ComfyUI-AnimateDiff-Evolved (動画・任意)。

起動:

```bash
cd ../ComfyUI && source venv/bin/activate
PYTORCH_ENABLE_MPS_FALLBACK=1 python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method auto
```

- `--listen 127.0.0.1 --port 8188` が既定値です。アプリ側の既定 URL は `http://127.0.0.1:8188`。
- `--preview-method auto` は進捗中のプレビューを有効にします (無くても進捗バーは動きます)。
- `PYTORCH_ENABLE_MPS_FALLBACK=1` は Metal 未対応の演算を CPU に逃がす PyTorch の環境変数です。
- 動画 (任意) を使うなら `brew install ffmpeg`。
- M1 では `--lowvram` 等の VRAM 系フラグは **効果がありません** (ユニファイドメモリは常に SHARED 扱い)。
  UNet は fp16 が既定。VAE は macOS 14+ では bf16 で動き、M1 では bf16 に専用回路が無いため VAE デコードが遅いことがあります。
  その場合は `--fp16-vae` (SDXL は fp16-fix VAE と併用)、黒い画像が出たら `--fp32-vae` を試してください ([TROUBLESHOOTING.md](TROUBLESHOOTING.md))。

### B. Comfy Desktop アプリを使う

https://www.comfy.org/download の macOS (Apple Silicon) 版でも動きます。

- インストール先は `~/ComfyUI-Installs/<name>/ComfyUI`、モデルはその `models/` (または `~/ComfyUI-Shared/models`)。
- ポートは v1.x の新規インストールでは 8188 が既定。旧 Electron 版 (アーカイブ済み) や、そこから引き継いだインストールは 8000 です。
  アプリの設定 → ComfyUI URL を合わせてください (`/system_stats` が返るかで確認できます)。
- カスタムノード (IP-Adapter など) は Desktop 内の Manager から入れられます。

### モデルの配置

```
ComfyUI/models/
├── checkpoints/        SD1.5 / SDXL / Pony / Illustrious の .safetensors  ← 必須
├── loras/              人物 LoRA、SDXL-Lightning / Hyper-SD の高速化 LoRA
├── vae/                (任意) sdxl_vae fp16-fix など
├── clip_vision/        IP-Adapter 用 CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
├── ipadapter/          ip-adapter-plus_sdxl_vit-h.safetensors など
└── animatediff_models/ mm_sd_v15_v2.ckpt (動画・任意)
```

IP-Adapter の重みは `bash scripts/download-ipadapter.sh ../ComfyUI sdxl` (または `sd15` / `both`) で取得できます。
ファイル名は Unified Loader が決め打ちで探すので変更しないでください。

## 3. アプリ

```bash
cd local-imagine
npm install
cp .env.example .env.local     # URL を変える場合だけ
npm run dev                    # http://localhost:3100
```

または 3 つまとめて:

```bash
bash scripts/start-all.sh [ComfyUI のパス]
```

初回起動時の画面で Ollama / ComfyUI への接続と、モデルの有無がチェックされます。
緑になっていなければ ⚙ 設定から URL を直し「保存」を押してください (保存時に再チェックします)。

## 4. 最初の人物を作る

1. 「人物を追加」→ 名前。
2. **外見 (appearance)**: 固定したい特徴だけを英語タグで。服は書かない (チャットで着せ替えるため)。
   例: `1girl, long black hair, brown eyes, slender, fair skin, adult woman, small beauty mark under left eye`
3. **画風 (style)**: `anime style, soft shading` / `photorealistic, 85mm lens, natural light` など。
4. **キャラクターシート**: 性格や好きな服など (日本語可)。LLM がシーンを考える材料になります。
5. 画像モデルを選んで「カフェで読書している姿を 2 枚」と送ってみてください。

## 5. 更新

```bash
git -C ../ComfyUI pull && (cd ../ComfyUI && source venv/bin/activate && pip install -r requirements.txt)
cd local-imagine && git pull && npm install
```
