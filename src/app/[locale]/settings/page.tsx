import { redirect } from 'next/navigation';

// 設定ページのルートにアクセスした場合、一般設定にリダイレクト
export default function SettingsPage() {
    redirect('/settings/general');
}
