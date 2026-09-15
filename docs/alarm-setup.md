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

> **重要: どの Firebase プロジェクトを使うか**
>
> このリポジトリには Firebase プロジェクトが 2 つ登場します。混同すると
> **プッシュがエラーも出さずに届かなくなります**。
>
> | 環境変数 | 値 | 用途 |
> |---|---|---|
> | `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT` | **`taskel-prod`** | **FCM 送信先（こちらを使う）** |
> | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `dev-t-chute-app` | Supabase 移行元のレガシー設定。FCM とは無関係 |
>
> FCM 送信は `src/lib/server/fcm.ts` が `FIREBASE_SERVICE_ACCOUNT` の `project_id`
> をそのままエンドポイントに使う実装なので、**Android アプリの登録先と
> `google-services.json` の取得元は必ず `taskel-prod`** にすること。
> 別プロジェクトの `google-services.json` を置くと、端末は別プロジェクトの
> トークンを登録してしまい、送信側は 404 UNREGISTERED を返して
> トークンを削除する（= 何も起きない）。

1. **`taskel-prod`** プロジェクトの設定 → 「アプリを追加」→ Android
2. **パッケージ名は `com.taskel.app`**（必ず一致させること）。SHA-1 は不要
3. `google-services.json` をダウンロード
4. リポジトリの **`android/app/google-services.json`** に配置
   - このファイルは配置しなくてもビルドは通る（build.gradle が存在チェックしてから
     google-services プラグインを適用する構成）。配置した場合のみ FCM が有効になる
   - **git 管理外（`android/.gitignore` で ignore 済み）なので、チェックアウトごとに
     手動配置が必要**。`git worktree` を使っている場合、メイン側に置いても
     worktree 側には存在しないため、そこでビルドすると FCM 無効の APK が
     黙って出来上がる（ビルドは成功するので気づきにくい）

     ```bash
     # worktree でビルドするときはメイン側からコピーする
     cp /path/to/main/android/app/google-services.json android/app/
     ```

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

### 5-0. 前提ツールチェーン（初回のみ・macOS / Homebrew）

このリポジトリは **AGP 8.13 / compileSdk 36 / Kotlin jvmTarget 21** の構成なので、
**JDK 21** と **Android SDK (platform 36 + build-tools 36)** が必要です。
Android Studio は不要（コマンドラインツールだけで完結します）。

```bash
# JDK 21（keg-only なので PATH には自動で入らない）
brew install openjdk@21

# Android SDK コマンドラインツール
brew install --cask android-commandlinetools

# ライセンス同意 + SDK 本体
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

さらに、Gradle に SDK の場所を教えるため **`android/local.properties`** を作成します
（gitignore 済み。チェックアウトごとに必要 — worktree を使う場合は worktree 側にも）。

```bash
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > android/local.properties
```

`java` を毎回 PATH に通すのが面倒なら、`~/.zshrc` に以下を追記しておくと以後は不要です。

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

### 5-1. ビルド

```bash
# 初回 or クローン直後は Capacitor 同期が必要
npx cap sync android

cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

`~/.zshrc` に追記していない場合は、`JAVA_HOME` を付けて実行します。

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug
```

## 6. サイドロード

APK を端末に入れる方法は 3 つ。**USB 接続は必須ではない**。

### 方法 A: Google ドライブ経由（USB 不要・おすすめ）

Mac に Google ドライブ デスクトップアプリが入っていれば、同期フォルダに
コピーするだけでよい（日付プレフィックスの命名で履歴を残す運用）。

```bash
cp android/app/build/outputs/apk/debug/app-debug.apk \
  ~/Library/CloudStorage/GoogleDrive-<アカウント>/マイドライブ/storage/$(date +%Y%m%d)_taskel.apk
```

端末側: ドライブアプリ（同じ Google アカウントでログイン）→ `storage` フォルダ →
該当 APK をタップ → ダウンロード → 通知から開く → インストール。
初回は「このアプリからの不明なアプリのインストールを許可」を求められるので、
ドライブアプリ（または Files アプリ）に対して許可する。

### 方法 B: ワイヤレス ADB（Android 11+・USB 不要）

繰り返しビルドして入れ替えるならこれが速い。Mac と端末が同じ LAN にあること。

1. 端末: 開発者向けオプション → **ワイヤレス デバッグ** を ON
2. 「ペア設定コードによるデバイスのペア設定」を開き、表示された IP:ポートとコードを使う

```bash
adb pair <端末IP>:<ペア用ポート>     # コードを入力（初回のみ）
adb connect <端末IP>:<デバッグ用ポート>
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### 方法 C: USB 接続

1. 端末の「設定 → セキュリティ」で提供元不明アプリのインストールを許可
2. 開発者向けオプションで「USB デバッグ」を有効化
   （設定 → デバイス情報 → ビルド番号を 7 回タップ）
3. `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
   - `adb devices` に出てこない場合は、端末に出る「USB デバッグを許可しますか」を許可

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

- **`Unable to locate a Java Runtime`**: JDK 未インストール、または keg-only の
  `openjdk@21` が PATH に入っていない。5-0 を実施する
- **`SDK location not found`**: `android/local.properties` が無い。5-0 の `echo ... >` を実行
  （このファイルは gitignore 済みなので、clone / worktree ごとに作り直しが必要）
- **`Failed to install the following SDK components ... licenses`**:
  `yes | sdkmanager --licenses` でライセンス未同意を解消する
- **プッシュが届かない**: Vercel の Function ログで `FCM:` プレフィックスのエラーを確認。
  端末側は `adb logcat -s TaskelFcmService TaskelAlarmScheduler` で受信ログを確認
- **インストール時に「既存のパッケージと署名が一致しません」**:
  別マシン（別の debug.keystore）でビルドした Taskel が既に入っている。
  一度アンインストールしてから入れ直す
- **アラームが鳴らない**: 権限バナーの 3 権限（特に「アラームとリマインダー」）と、
  メーカー独自の電池管理設定（自動起動許可など）を確認
- **トークンが registration される気配がない**: google-services.json 配置後に
  `npx cap sync android` → 再ビルドしたか確認（配置しただけでは反映されない）
- **ビルドは通るのに FCM が効かない**: そのビルドに google-services.json が
  含まれていない可能性が高い（特に worktree）。以下で焼き込まれたか検証できる。
  `project_id` が `taskel-prod`、`gcm_defaultSenderId` が `289232867204` なら正しい。

  ```bash
  grep -o 'name="project_id"[^>]*>[^<]*' \
    android/app/build/generated/res/processDebugGoogleServices/values/values.xml
  ```

  ファイルごと存在しなければ google-services プラグインが適用されていない
  （= FCM 無効の APK）。`android/app/google-services.json` を置いて再ビルドする
