# アーキテクチャ / 作り方

## 全体像

```
ブラウザ (Next.js App Router, React 19, Tailwind v4, Zustand)
   │  fetch + Server-Sent Events
   ▼
Next.js route handlers (src/app/api/**)  ──────────────┐
   │                                                    │
   ├─ src/lib/server/agent.ts     会話 1 ターンのオーケストレーション
   ├─ src/lib/server/ollama.ts    Ollama REST (/api/tags, /api/chat with format=JSON schema)
   ├─ src/lib/server/comfy.ts     ComfyUI REST + WebSocket (/prompt, /ws, /history, /view, /upload/image, /object_info)
   ├─ src/lib/server/workflows.ts GenParams → ComfyUI API 形式のワークフロー JSON
   ├─ src/lib/server/generate.ts  バッチ実行 (1 枚ずつキュー、進捗、保存)
   ├─ src/lib/server/prompts.ts   システムプロンプト、品質タグ、ネガティブ、合成
   └─ src/lib/server/store.ts     JSON ファイル永続化 (data/)
```

ブラウザは Ollama / ComfyUI に直接アクセスしません。すべて Next.js のサーバー側から呼ぶため、
ComfyUI の `--enable-cors-header` も Ollama の `OLLAMA_ORIGINS` も不要です。

## データモデル (`src/lib/types.ts`)

| 型 | 保存先 | 内容 |
| --- | --- | --- |
| `Settings` | `data/settings.json` | URL、モデル、生成の既定値、NSFW、動画設定 |
| `Persona` | `data/personas/<id>/persona.json` | 名前、外見 (appearance)、画風、キャラシート、ネガティブ、参照画像、LoRA、NSFW |
| `Chat` | `data/chats/<id>.json` | personaId、タイトル、`Message[]` |
| `Message` | (Chat 内) | role、content、attachments、`GenerationBatch[]` |
| `GenerationBatch` | (Message 内) | 最終プロンプト、`GenParams`、`GeneratedImage[]`、status |
| 画像 | `data/images/<chatId>/<batchId>_<i>_<seed>.png` | ComfyUI から取得した出力をコピー |

DB を使わないのは、単一ユーザー・ローカル前提で、フォルダをコピーするだけでバックアップできるためです。
書き込みは tmp + rename でアトミック、同じチャットへの更新は `mutateChat()` でロックして直列化しています。

## 1 ターンの流れ (`agent.ts: runChatTurn`)

1. ユーザー発言を保存 → SSE `user_message`
2. 添付画像があり画像認識モデルが設定されていれば、Ollama にbase64 で渡して説明文を作る (`describeAttachments`)
3. システムプロンプト (`prompts.ts: buildSystemPrompt`) を組み立てる
   - 人物シート、固定外見・画風は「自動挿入されるので書くな」と伝える
   - checkpoint 系統からプロンプト流儀 (タグ / 自然文) を決める
   - NSFW ポリシー (許可 / 不許可) と絶対禁止事項
   - 出力は JSON のみ: `{ reply, generations: [{ prompt, negative_prompt, count, aspect, use_reference_images }] }`
4. `ollamaChatJson()` で `format` に JSON Schema を渡して呼ぶ (`think: false`, `num_ctx`, `keep_alive` も設定から)
   - 400 が返れば `think` を外して再試行、コードフェンス付き JSON も救済
5. プランを `GenerationBatch` に変換: `composePositive()` で `[trigger] + [quality] + [appearance] + [scene] + [style]`、
   `composeNegative()` で `[family default] + [persona] + [scene]` を重複除去して合成。`resolveParams()` で解像度・steps・CFG・CLIP skip・LoRA を決定
6. アシスタント発言を保存 → SSE `assistant_message`
7. バッチを順に `runBatch()` (GPU は 1 つなので直列) → SSE `batch_start / progress / image / batch_end`
8. SSE `done`

LLM に履歴を渡すときは、過去のアシスタント発言を **同じ JSON 形式に再構成** して渡します (`historyToOllama`)。
小さいモデルでも出力形式が安定します。

## 画像生成 (`generate.ts`, `workflows.ts`, `comfy.ts`)

- `batchCount` 枚を **1 枚ずつ別プロンプトとしてキュー** します。`batch_size>1` よりメモリに優しく、1 枚目から表示できます。
- 参照画像 / init 画像は `POST /upload/image` (multipart, field `image`, `subfolder=local-imagine`) で ComfyUI の input に置き、`LoadImage` で参照します。
- `runWorkflow()`:
  1. `ws://host/ws?clientId=<id>` を開く (同じ `client_id` を `/prompt` に渡さないと進捗が届かない)
  2. `POST /prompt` → `prompt_id`
  3. `progress` → 進捗、`execution_error` / `execution_interrupted` → 失敗、`execution_success` または `executing{node:null}` → 完了
  4. 保険として `/history/<id>` を 1.5 秒ごとにポーリング (WebSocket が開けない環境でも動く)
  5. `/history` の `outputs[*].images|gifs|videos` を集めて `/view` で取得 → `data/images/` に保存
- ワークフローはノード id を文字列、リンクを `[id, outputIndex]` で表す ComfyUI の API 形式です。

### txt2img グラフ

```
CheckpointLoaderSimple ─┬─ MODEL ─ LoraLoader* ─ (IPAdapterUnifiedLoader → IPAdapterAdvanced)* ─┐
                        ├─ CLIP ─ LoraLoader* ─ (CLIPSetLastLayer)* ─┬─ CLIPTextEncode(+) ─┐     │
                        │                                             └─ CLIPTextEncode(−) ─┤     │
                        └─ VAE ───────────────────────────────┐  EmptyLatentImage ──────────┴─ KSampler ─ VAEDecode ─ SaveImage
                                                              └──────────────────────────────────────────┘
```

- `*` は条件付き。img2img は `LoadImage → VAEEncode` が `EmptyLatentImage` の代わりになり `denoise < 1`。
- IP-Adapter は複数の参照画像を `ImageBatch` で束ね、`combine_embeds=average` で平均化。
  preset は `/object_info` の `IPAdapterModelLoader.ipadapter_file` から **実際に存在する重み** に合わせて選びます (`chooseIpAdapterPreset`)。
- 選択肢の文字列 (preset, weight_type など) は `/object_info` の列挙から `pickOption()` で選ぶため、ノードの版違いで文字列が変わっても落ちにくくしています。

## API 一覧

| Method | Path | 内容 |
| --- | --- | --- |
| GET/PUT | `/api/settings` | 設定の取得 / 部分更新 |
| GET | `/api/health` | Ollama (`/api/version`) と ComfyUI (`/system_stats`) の疎通 |
| GET | `/api/models/llm` | Ollama `/api/tags` |
| GET | `/api/models/image?refresh=1` | ComfyUI `/object_info` から checkpoint / LoRA / sampler / 動画ノードの有無 |
| GET/POST | `/api/personas`, `/api/personas/[id]` (GET/PATCH/DELETE) | 人物 CRUD |
| POST/DELETE | `/api/personas/[id]/refs` | 参照画像の追加 (multipart `files` または `{fromGenerated}`) / 削除 |
| GET/POST | `/api/chats?personaId=`, `/api/chats/[id]` (GET/PATCH/DELETE) | チャット CRUD |
| POST | `/api/chats/[id]/messages` | **SSE**。`{content, attachments}` → 1 ターン実行 |
| POST | `/api/generate` | **SSE**。LLM を介さない直接生成 (バリエーション、再試行、動画化) |
| POST | `/api/uploads` | チャットへの添付画像を `data/uploads/<chatId>/` に保存 |
| POST | `/api/comfy/interrupt` | ComfyUI `/interrupt` |
| GET | `/api/files/[...path]` | `data/` 配下のファイル配信 (Range 対応、パストラバーサル防止) |

SSE のイベント型は `src/lib/types.ts` の `StreamEvent`。クライアントは `src/lib/api.ts: streamPost()` で読み、
`src/store/useAppStore.ts: handleEvent()` で状態に反映します。

## フロントエンド

- `Studio.tsx` がレイアウト。`Sidebar` (人物・チャット)、`TopBar` (モデル選択)、`ChatView` + `MessageItem` + `GenerationGrid`、`ChatInput`、`PersonaPanel`、`SettingsModal`、`Lightbox`。
- 状態は Zustand 1 ストア。選択中の人物/チャットは localStorage に記憶。
- 画像は `/api/files/...` を `<img>` で直接表示 (next/image は使わない: ローカル配信なので最適化不要)。

## 拡張のヒント

| やりたいこと | 触る場所 |
| --- | --- |
| ポーズ画像からポーズを写す (ControlNet OpenPose) | `workflows.ts` に `ControlNetLoader + ControlNetApplyAdvanced` を追加、`GenParams` に `poseImage` |
| 別の画像バックエンド (mflux / Draw Things / A1111) | `comfy.ts` と同じ形の `runWorkflow()` 相当を実装し `generate.ts` で切替 |
| LLM をツール呼び出し方式にする | `agent.ts` の `format` を `tools` に置換 (Ollama は `message.tool_calls[].function.{name,arguments}`) |
| LM Studio を使う | `ollama.ts` に OpenAI 互換 (`/v1/chat/completions`, `response_format`) クライアントを追加 |
| アップスケール | `VAEDecode` の後に `ImageUpscaleWithModel` を挟む |
| Flux (GGUF) | `UnetLoaderGGUF + DualCLIPLoaderGGUF + VAELoader` のグラフを `workflows.ts` に追加 |

## テスト

```bash
npm test                          # vitest: プロンプト合成、ワークフロー生成、パス検証
node scripts/mock-backends.mjs    # モック Ollama (11435) + モック ComfyUI (8189, WebSocket 進捗付き)
OLLAMA_URL=http://127.0.0.1:11435 COMFYUI_URL=http://127.0.0.1:8189 DATA_DIR=/tmp/li-data npm run dev
```

モックは固定のプランとグラデーション PNG を返すので、GPU の無い環境でも UI と SSE の流れを確認できます。
