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
    },
};

export default config;
