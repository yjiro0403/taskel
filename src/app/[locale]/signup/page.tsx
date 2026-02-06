import { AuthForm } from '@/components/AuthForm';

export default function SignupPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
            <AuthForm isLogin={false} />
        </div>
    );
}
