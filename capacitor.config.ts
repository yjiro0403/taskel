import type { CapacitorConfig } from '@capacitor/cli';

// リモートURL方式: WebView は常に本番の Vercel デプロイを表示する。
// Web を更新すればアプリ側の再ビルドなしで最新になる（個人利用のサイドロード前提）。
// webDir はネイティブビルド時に必須なだけのダミー（native/webdir/index.html）。
const config: CapacitorConfig = {
    appId: 'com.taskel.app',
    appName: 'Taskel',
    webDir: 'native/webdir',
    server: {
        url: 'https://taskel.vercel.app',
        // 本番HTTPSのみを表示するため cleartext は許可しない
        cleartext: false,
        // Capacitor は server.url 以外のホストへの画面遷移を外部ブラウザ（Chrome）で開く。
        // Google ログインは WebView → Supabase Auth → accounts.google.com → Supabase →
        // taskel.vercel.app/auth/callback と遷移するため、途中のホストを許可しないと
        // ログインが Chrome 側で完了してしまい、アプリは読み込み中のまま止まる。
        // ここに挙げたホストだけは WebView 内で遷移を続ける（Google カレンダー連携の
        // 再認可も同じ経路を通る）。
        allowNavigation: [
            '*.supabase.co',
            'accounts.google.com',
            '*.google.com',
            '*.googleapis.com',
            '*.gstatic.com',
            'accounts.youtube.com',
        ],
    },
    android: {
        // Google は UA に "; wv)" を含む Android WebView からの OAuth を
        // 「403 disallowed_useragent」で拒否する。本アプリは Chrome の UA を名乗って
        // WebView 内でログインを完結させる（個人利用のサイドロード前提）。
        // 判定はネイティブ側の window.Capacitor で行うため UA には依存しない。
        overrideUserAgent:
            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    },
};

export default config;
