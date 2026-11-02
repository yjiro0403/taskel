# トラブルシューティング

## 接続

| 症状 | 対処 |
| --- | --- |
| サイドバーの Ollama が赤 | `curl http://127.0.0.1:11434/api/version`。メニューバーの Ollama を起動、または `ollama serve`。URL は設定で変更可 |
| ComfyUI が赤 | `curl http://127.0.0.1:8188/system_stats`。Comfy Desktop のポートは Launch Args 次第 (新規 8188 / 旧版から引き継いだものは 8000) → 設定の ComfyUI URL を修正 |
| 「LLM モデルが選択されていません」 | `ollama pull <model>` 後、上部バーの ↻ で一覧更新 |
| checkpoint の一覧が空 | `ComfyUI/models/checkpoints/` に .safetensors を置き ComfyUI を再起動 → ↻ |
| 参照画像が効かない / 「IP-Adapter ノードが無い」 | `custom_nodes/ComfyUI_IPAdapter_plus` の導入と `models/ipadapter`, `models/clip_vision` の重み ([PERSONA_AND_LORA.md](PERSONA_AND_LORA.md)) |

## ComfyUI (M1 / MPS)

| 症状 | 対処 |
| --- | --- |
| 真っ黒 / 単色 / NaN の画像 | `--fp32-vae` を付ける (macOS 14+ の既定は bf16 VAE)。`--fp16-vae` を付けているなら外すか `sdxl-vae-fp16-fix` を `models/vae` に入れて使う。`--force-upcast-attention` も試す。bf16 前提のモデル (Z-Image, Qwen) に `--force-fp16` は付けない |
| `Trying to convert Float8_e4m3fn to the MPS backend` | fp8 のモデルは Mac で使えません。fp16 / bf16 / GGUF 版を使う |
| `MPS backend out of memory` | 解像度を下げる (832×1216 → 768×1024)、SDXL → SD1.5、LLM の keep_alive を `0`、他のアプリを閉じる、`--cache-none`。`--lowvram` は MPS では無効 |
| 遅すぎる | 高速モード (Lightning/Hyper LoRA)、steps 20、`--use-pytorch-cross-attention` を試す (既定は sub-quadratic attention)。SDXL 1024px は M1 で 1–2 分/枚が普通 |
| VAE デコードが異常に遅い (生成の最後で数十秒止まる) | macOS 14+ では VAE が bf16 で動き、M1 では 5–10 倍遅いという報告 (ComfyUI PR #16996)。`--fp16-vae` を試し、黒くなったら `--fp32-vae` に |
| ComfyUI がモデルを抱えたままメモリが足りない | `curl -X POST http://127.0.0.1:8188/free -H 'content-type: application/json' -d '{"unload_models":true,"free_memory":true}'` でモデルを解放 |
| `aten::... is not implemented for MPS` | `PYTORCH_ENABLE_MPS_FALLBACK=1` を付けて起動 (`scripts/start-all.sh` は付けています)。PyTorch を nightly に更新 |
| `--force-channels-last` でエラー | MPS 非対応。付けない |
| カスタムノードの import エラー | そのノードの `requirements.txt` を venv に入れ直す。numpy 2.x 非対応ノードは `pip install numpy==1.26.4` |
| ComfyUI が `Value not in list: ckpt_name` を返す | 設定の checkpoint 名が古い。↻ で一覧を更新し選び直す |

## Ollama

| 症状 | 対処 |
| --- | --- |
| 返答に数分かかる | 推論 (thinking) 付きモデル。アプリは `think:false` を送りますが、対応しないモデルは `qwen3.5` / `gemma4` などに変更 |
| JSON を返さない / `did not return valid JSON` | モデルが小さすぎる・古い。`qwen3.5:4b` 以上を推奨。Temperature を 0.5 程度に下げる |
| 画像認識モデルが画像を無視する | `ollama show <model>` の capabilities に `vision` があるか確認。`qwen3-vl` / `gemma4` を使う |
| NSFW の依頼を拒否する | 設定と人物の両方で NSFW を許可。拒否が続くなら abliterated 版モデル ([MODELS.md](MODELS.md)) |
| コンテキスト超過で過去を忘れる | 設定の「コンテキスト長」を 8192–16384 に、「履歴の数」を調整 |

## アプリ

| 症状 | 対処 |
| --- | --- |
| 生成中にブラウザを閉じた | サーバー側は続行し `data/` に保存されます。再読込で表示されます。止めたい場合は「中止」(ComfyUI `/interrupt`) |
| `Path escapes data dir` | `/api/files` に不正なパス。通常は出ません |
| ポート 3100 が使用中 | `npm run dev -- -p 3200` |
| 親リポジトリ (taskel) の `npm run typecheck` にこのアプリが混ざる | 親の `tsconfig.json` で `local-imagine` を exclude 済み。アプリは独立した `package.json` を持ちます |

## ログの場所

- `scripts/start-all.sh` 使用時: `local-imagine/ollama.log`, `local-imagine/comfyui.log`
- Ollama アプリ: `~/.ollama/logs/server.log`
- ComfyUI の実行エラーは SSE 経由でチャットのバッチ下に赤字で表示されます (`ComfyUI error in <node>: ...`)
