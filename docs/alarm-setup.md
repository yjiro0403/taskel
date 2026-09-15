# Taskel アラーム機能 セットアップ手順（Android / 個人利用サイドロード）

Taskel の Android アプリ（Capacitor）でアラームを使うための残作業手順です。

## 前提: 2 つの動作モード

| モード | 必要な設定 | 同期タイミング |
|---|---|---|
| 起動時同期のみ（Phase B） | なし（このままビルドすれば動く） | アプリ起動時・フォアグラウンド復帰時に全件同期 |
| FCM 即時同期あり（Phase C） | Firebase 設定（本手順） | 上記に加え、Web でアラームを作成/変更/削除した瞬間に端末へプッシュ反映 |

**Firebase 未設定でもアプリはクラッシュせず、起動時同期のみで動作します。**
FCM 送信側（Next.js）も `FIREBASE_SERVICE_ACCOUNT` 未設定なら静かにスキップします。

## 1. Firebase プロジェクト作成

1. https://console.firebase.google.com/ で「プロジェクトを追加」
2. プロジェクト名は任意（例: `taskel`）。Google アナリティクスは不要なので無効で OK

## 2. Android アプリを登録して google-services.json を配置

1. プロジェクトの設定 → 「アプリを追加」→ Android
2. **パッケージ名は `com.taskel.app`**（必ず一致させること）。SHA-1 は不要
3. `google-services.json` をダウンロード
4. リポジトリの **`android/app/google-services.json`** に配置
   - このファイルは配置しなくてもビルドは通る（build.gradle が存在チェックしてから
     google-services プラグインを適用する構成）。配置した場合のみ FCM が有効になる

## 3. サービスアカウント JSON の発行（サーバー送信用）

1. Firebase コンソール → プロジェクトの設定 → 「サービス アカウント」タブ
2. 「新しい秘密鍵の生成」→ JSON ファイルをダウンロード
3. この JSON が FCM HTTP v1 API の認証情報になる。**リポジトリにはコミットしないこと**

## 4. FIREBASE_SERVICE_ACCOUNT 環境変数の設定

サービスアカウント JSON の中身（テキスト全体）をそのまま 1 つの環境変数に入れます。

- **ローカル**: `.env.local` に追記

  ```
  FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"..."}
  ```

  （1 行にまとめる。`jq -c . service-account.json` で 1 行化すると楽）

- **Vercel**: Project Settings → Environment Variables に
  `FIREBASE_SERVICE_ACCOUNT` を追加（値は JSON をそのまま貼り付け）→ 再デプロイ

## 5. APK ビルド

```bash
# 初回 or クローン直後は Capacitor 同期が必要
npx cap sync android

cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## 6. サイドロード

1. 端末の「設定 → セキュリティ」で提供元不明アプリのインストールを許可
2. `app-debug.apk` を端末へ転送してインストール
   （USB 接続なら `adb install -r app-debug.apk` が手軽）

## 7. 初回起動時の権限許可

1. アプリを起動して Taskel にログイン
2. 画面下部にアラーム権限の案内バナーが出たら「許可する」をタップし、順に許可:
   1. **通知**（Android 13+ の実行時権限。全画面アラーム表示に必要）
   2. **アラームとリマインダー**（Android 12 系のみ。13+ は自動付与）
   3. **電池の最適化の除外**（任意。メーカー独自のバックグラウンド kill 対策）
3. Firebase 設定済みビルドなら、ログイン時に FCM トークンが自動で
   `/api/device-tokens` に登録される（操作不要）

## 動作確認

1. Web（または端末のアプリ）でタスクにアラームを設定
2. FCM 設定済みなら数秒以内に端末へ反映される（ステータスバーに時計アイコン）
3. 発火 → 全画面アラーム表示 → 「停止」または「スヌーズ」
4. 次にアプリを開いたとき、停止（status=dismissed）/スヌーズ（fire_at 更新）が
   Supabase へ書き戻され、Web の一覧にも反映される

## トラブルシューティング

- **プッシュが届かない**: Vercel の Function ログで `FCM:` プレフィックスのエラーを確認。
  端末側は `adb logcat -s TaskelFcmService TaskelAlarmScheduler` で受信ログを確認
- **アラームが鳴らない**: 権限バナーの 3 権限（特に「アラームとリマインダー」）と、
  メーカー独自の電池管理設定（自動起動許可など）を確認
- **トークンが registration される気配がない**: google-services.json 配置後に
  `npx cap sync android` → 再ビルドしたか確認（配置しただけでは反映されない）
