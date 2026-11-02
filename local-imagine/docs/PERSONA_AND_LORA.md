# 人物の一貫性 — 「この子の画像を作って」を実現する 3 段階

目標: 複数の参照画像を渡して「この女の子の画像を作成して」と言えるようにする。
M1 (8–16GB) では以下の順に積み上げるのが現実的です。

| 段階 | 仕組み | 一貫性 | 追加コスト | 状態 |
| --- | --- | --- | --- | --- |
| 1. プロンプト固定 | 人物の「外見」タグを毎回自動挿入 | 中 (髪・目・体型は揃う。顔は似る程度) | なし | 実装済み |
| 2. IP-Adapter | 参照画像の埋め込みで顔・雰囲気を誘導 | 高 (同じ顔立ちに近づく) | 重み 1–2GB、1 枚あたり +10–30% | 実装済み |
| 3. LoRA | その人物で学習した重みを読み込む | 最高 | 学習に数時間〜 (M1 では SD1.5 が限界) | 読込は実装済み。学習は手順のみ |

## 段階 1: プロンプト固定 (今すぐ使える)

人物パネルの **外見 (appearance)** は、LLM が書いたシーン描写の前に **必ず** 挿入されます (`composePositive`)。
LLM には「外見は自動挿入されるので書くな」と指示してあり、LLM の気分で髪色が変わることを防ぎます。

コツ:

- 固定したい特徴だけ: 髪 (色・長さ・型)、目、体型、肌、年齢感 (`adult woman`)、ほくろ等の目印。
- 服は書かない。服は「キャラクターシート」に好みを書いておき、チャットで着せ替えます。
- 画風は **画風 (style)** に分ける。同じ人物を実写でもアニメでも出したいときは人物を 2 つ作るのが簡単です。
- 同じ checkpoint を使い続ける (人物ごとに checkpoint を固定可)。

## 段階 2: IP-Adapter (参照画像)

### セットアップ

```bash
bash scripts/setup-comfyui.sh                       # ComfyUI_IPAdapter_plus を導入
bash scripts/download-ipadapter.sh ../ComfyUI sdxl  # 重み (SDXL 用)。SD1.5 なら sd15、両方なら both
# ComfyUI を再起動 → アプリの上部バー ↻ でモデル一覧を更新
```

配置されるファイル:

```
models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
models/ipadapter/ip-adapter_sdxl_vit-h.safetensors            (STANDARD)
models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors       (PLUS)
models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors  (PLUS FACE ← 顔向け。あれば優先)
```

### 使い方

1. 人物パネル → 参照画像に 1–4 枚ドロップ (顔がはっきり写った正面〜斜めの画像が効きます)。
   生成画像から選ぶ場合はライトボックスの「参照に追加」。
2. 以降、LLM が `use_reference_images: true` を返した生成に IP-Adapter が適用されます
   (無関係なもの、例えば風景だけの依頼では自動的に外れます)。
3. 強さは設定の「IP-Adapter 強度」(既定 0.7)。似なければ 0.8–0.9、ポーズの自由度が下がれば 0.5–0.6。
4. チャットに画像を添付して「この画像の子を作って」と送ると、その添付も参照画像として使われます。
   設定で「画像認識モデル」を指定しておくと、LLM が添付内容を理解したうえでプロンプトを書きます。

### 仕組み

```
LoadImage ×N → ImageBatch → IPAdapterUnifiedLoader(preset=PLUS FACE) → IPAdapterAdvanced(weight, linear, average, end_at 0.9) → KSampler
```

- preset は `models/ipadapter` に **実際にあるファイル** から選びます (SDXL なら plus-face → plus → standard の順)。
- 参照画像が複数あるときは埋め込みを平均化 (`combine_embeds=average`) します。
- FaceID 系 (insightface 必須) は使っていません。insightface 2.1 以降は純 Python wheel になり Mac でも入りやすくなりましたが、
  まずは依存の無い PLUS FACE を既定にしています。顔の固定をさらに強くしたい場合は FaceID PLUS V2 / InstantID (SDXL) を
  ComfyUI で試し、`workflows.ts` の IP-Adapter 部分を差し替えてください。

### 限界

- IP-Adapter は「似る」であって「同一人物」ではありません。ポーズや画角が大きく変わると崩れます。
- 顔以外 (服・髪型) も参照に引きずられるので、着せ替えが効きにくいときは強度を下げるか、
  参照画像を顔中心にトリミングしてください。

## 段階 3: LoRA

### 読み込み (実装済み)

1. 学習した `.safetensors` を `ComfyUI/models/loras/` に置く → ComfyUI 再起動 → アプリで ↻。
2. 人物パネル → LoRA を選択、強度 0.7–0.9、トリガーワード (学習時のキャプション先頭の語、例 `ohwx_aoi`) を入力。
3. 以後、プロンプトの先頭にトリガーワードが入り、`LoraLoader` (strength_model = strength_clip) がグラフに挿入されます。
4. Civitai (civitai.red) のキャラクター LoRA もそのまま使えます (トリガーワードはモデルページに記載)。

### 学習 (手順)

**データセット** (どのトレーナーでも共通):

- 15–30 枚。場所・服・ポーズ・表情・画角を **変える** (似た画像 60 枚より多様な 25 枚)。顔アップ / 上半身 / 全身をバランスよく。
- キャプションは `ohwx_aoi, ...` のようにトリガーワードから始め、**顔・髪・目など固定したい特徴は書かず**、服やポーズなど変えたいものだけ書く。
- SDXL なら Danbooru タグ、Flux 系なら自然文。
- 本アプリの参照画像 (`data/personas/<id>/refs/`) や生成画像をそのまま素材にできます。

**どこで学習するか** (2026 年 11 月時点):

| 方法 | 対象 | M1 16GB での現実 |
| --- | --- | --- |
| クラウド GPU (RunPod / Colab など) + kohya_ss / ai-toolkit | SD1.5 / SDXL / Flux | **推奨**。SDXL LoRA が 20–40 分。出来た .safetensors を `models/loras` へ |
| Draw Things (App Store) | SD1.5 / SDXL | Mac 上で最も実用的な GUI。SDXL 1024 は 16GB だと遅くスワップしがち |
| kohya sd-scripts を Mac で | SD1.5 | 公式には非対応。コミュニティ報告で M1 Air 16GB は 512px 1 step 45 秒前後 (数時間)。SDXL は OOM しやすい |
| mflux-train (MLX) | Flux.2 Klein / Z-Image | Mac ネイティブだが想定メモリ 32–36GB。16GB は対象外 |
| OneTrainer / SimpleTuner / ai-toolkit on MPS | – | 実験的。Flux 系は「行き止まり」と報告あり |

学習パラメータの目安 (SDXL, kohya): rank 16–32 / alpha 16、学習率 1e-4、1500–3000 steps、250 steps ごとに保存して
「同一性が保たれる最も早いチェックポイント」を採用。

### 将来の自動化 (未実装)

- 人物パネルに「学習セットを書き出す」ボタンを付け、参照画像 + 自動キャプション (画像認識モデルで生成) を
  `data/personas/<id>/training/` に出力 → kohya 形式のフォルダにする。
- ControlNet OpenPose を加えて「この画像と同じポーズで」を実現する (`ARCHITECTURE.md` の拡張のヒント)。
