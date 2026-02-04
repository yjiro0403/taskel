import Link from 'next/link';
import { ArrowRight, Play, Clock, BarChart3, Layout, Calendar } from 'lucide-react';
import Image from 'next/image';

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-blue-100 selection:text-blue-900">
            {/* Header */}
            <header className="fixed top-0 w-full bg-white/90 backdrop-blur-md z-50 border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="relative h-8 w-auto">
                            <Image
                                src="/logo.png"
                                alt="Taskel Logo"
                                width={32}
                                height={32}
                                className="object-contain h-full w-auto"
                                priority
                            />
                        </div>
                        <span className="text-xl font-bold tracking-tight text-gray-900">Taskel</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <Link href="/login" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                            Log in
                        </Link>
                        <Link
                            href="/signup"
                            className="px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-all shadow-sm hover:shadow-md"
                        >
                            Get Started
                        </Link>
                    </div>
                </div>
            </header>

            {/* Hero Section */}
            <section className="pt-40 pb-24 px-6">
                <div className="max-w-4xl mx-auto text-center space-y-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold tracking-wide uppercase">
                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                        Alpha Version Live
                    </div>

                    <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight leading-tight text-gray-900">
                        Focus on <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">execution.</span>
                    </h1>

                    <p className="text-xl md:text-2xl text-gray-500 max-w-2xl mx-auto leading-relaxed font-light">
                        The smart task partner for professionals.<br className="hidden md:block" />
                        計画と実行のズレをなくし、あなたのパフォーマンスを最大化する。<br />
                        時間の流れを可視化する、新しいタスク管理ツール。
                    </p>

                    <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            href="/signup"
                            className="w-full sm:w-auto px-8 py-4 bg-gray-900 text-white text-lg font-medium rounded-xl hover:bg-gray-800 transition-all hover:scale-[1.02] shadow-xl shadow-gray-200 flex items-center justify-center gap-2"
                        >
                            Start Using Taskel <ArrowRight size={20} />
                        </Link>
                    </div>
                </div>
            </section>

            {/* Core Values / Features form Draft */}
            <section className="py-24 bg-gray-50/50 border-t border-gray-100">
                <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-12">
                    {/* Visualized Timeline */}
                    <div className="group space-y-4">
                        <div className="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-blue-600 shadow-sm group-hover:scale-110 transition-transform duration-300">
                            <Clock size={24} strokeWidth={2} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">Visualized Timeline</h3>
                        <p className="text-gray-500 leading-relaxed">
                            <strong>時間を「視覚」で捉える。</strong><br />
                            1日の残り時間とタスクの総量をリアルタイムに可視化。「なんとなく」の不安を消し去り、明瞭な見通し（Visibility）を提供します。
                        </p>
                    </div>

                    {/* Seamless Execution */}
                    <div className="group space-y-4">
                        <div className="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-indigo-600 shadow-sm group-hover:scale-110 transition-transform duration-300">
                            <Play size={24} strokeWidth={2} /> {/* Play icon for execution */}
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">Seamless Execution</h3>
                        <p className="text-gray-500 leading-relaxed">
                            <strong>思考を止めない、スムーズな実行。</strong><br />
                            タスクの開始・終了は、再生ボタンを押すだけのワンアクション。複雑な操作を排除し、フロー状態への没入を妨げません。
                        </p>
                    </div>

                    {/* Reliable Logging */}
                    <div className="group space-y-4">
                        <div className="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-emerald-600 shadow-sm group-hover:scale-110 transition-transform duration-300">
                            <BarChart3 size={24} strokeWidth={2} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">Reliable Logging</h3>
                        <p className="text-gray-500 leading-relaxed">
                            <strong>実績が、次の計画を磨く。</strong><br />
                            予実管理を自動でログ化。感覚ではなくデータに基づいたフィードバックループが、あなたの時間感覚をより鋭敏にします。
                        </p>
                    </div>
                </div>
            </section>

            {/* Key Features Table Section (Simplified) */}
            <section className="py-24 bg-white border-t border-gray-100">
                <div className="max-w-4xl mx-auto px-6">
                    <h2 className="text-3xl font-bold text-center mb-16">Key Features</h2>
                    <div className="grid gap-8">
                        <div className="flex gap-6 items-start">
                            <div className="p-3 bg-gray-100 rounded-lg"><Layout size={24} className="text-gray-700" /></div>
                            <div>
                                <h3 className="text-xl font-bold mb-2">Section Planning</h3>
                                <p className="text-gray-600">1日を時間帯（セクション）で分割管理。コンテキストに合わせた無理のない計画立案。</p>
                            </div>
                        </div>
                        <div className="flex gap-6 items-start">
                            <div className="p-3 bg-gray-100 rounded-lg"><Play size={24} className="text-gray-700" /></div>
                            <div>
                                <h3 className="text-xl font-bold mb-2">One-Click Timer</h3>
                                <p className="text-gray-600">直感的なストップウォッチ機能。現在実行中のタスクを明確化。</p>
                            </div>
                        </div>
                        <div className="flex gap-6 items-start">
                            <div className="p-3 bg-gray-100 rounded-lg"><Calendar size={24} className="text-gray-700" /></div>
                            <div>
                                <h3 className="text-xl font-bold mb-2">Hierarchical Planning</h3>
                                <p className="text-gray-600">イヤリー、マンスリー、ウィークリーの各期間でゴールを設定。上位の目標に基づいたタスク設計で、迷いのない実行を実現。</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto px-6 flex flex-col items-center justify-center gap-6">
                    <p className="text-gray-400 text-sm font-medium">© {new Date().getFullYear()} Taskel (t-chute). Simple, yet powerful.</p>
                    <div className="flex gap-8 text-sm text-gray-500">
                        <Link href="/terms" className="hover:text-gray-900 transition-colors">利用規約</Link>
                        <Link href="/privacy" className="hover:text-gray-900 transition-colors">プライバシーポリシー</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
