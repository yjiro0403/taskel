# 管理スクリプト

Taskel (T-Chute) の開発・デモ用データ管理スクリプトです。

## セットアップ

### 1. サービスアカウントキーの取得
1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. プロジェクトを選択（開発用プロジェクト推奨）
3. **プロジェクトの設定** > **サービスアカウント** タブを開く
4. **新しい秘密鍵の生成** をクリックして JSON ファイルをダウンロード
5. プロジェクトのルートディレクトリに `SERVICE_ACCOUNT_KEY.json` という名前で保存

> [!WARNING]
> `SERVICE_ACCOUNT_KEY.json` は **絶対に Git にコミットしないでください**（`.gitignore` に設定済み）。

## コマンド一覧

### デモデータの投入 (基本)
指定したユーザーIDのデータを全て削除し、新しいダミーデータを投入します。

```bash
npm run seed:demo -- --userId=<ユーザーUID>
```

実行例:
```bash
npm run seed:demo -- --userId=abc123xyz
```

### ビデオ撮影用リッチデータの投入
動画などで見栄えがするように、大量のデータ（過去・未来のタスクを含む）を生成します。

```bash
npm run seed:demo -- --userId=<ユーザーUID> --scale=large
```

### Dry Run (実行シミュレーション)
実際の削除・書き込みは行わず、何が起こるかを確認します。

```bash
npm run seed:demo -- --userId=<ユーザーUID> --dry-run
```

### データ削除のみ
ダミーデータを生成せず、既存データをクリーンアップします。

```bash
npm run seed:demo -- --userId=<ユーザーUID> --clear-only
```
