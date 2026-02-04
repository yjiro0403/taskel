import { AuthForm } from '@/components/AuthForm';

export default function LoginPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
            <AuthForm isLogin={true} />
        </div>
    );
}
