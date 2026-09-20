'use client';

/**
 * Fictional demo frames for the public landing page.
 * Labels are dummy product copy — never personal user data.
 */
export function TimelineMock() {
    return (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden text-left">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">Tue 9/16 · Demo</span>
                <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">Timeline</span>
            </div>
            <div className="relative h-[340px] bg-gray-50">
                {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'].map((label, index) => (
                    <div key={label} className="absolute left-0 right-0 border-t border-gray-200" style={{ top: 16 + index * 44 }}>
                        <span className="absolute left-3 -top-2 text-[10px] font-mono text-gray-500">{label}</span>
                    </div>
                ))}
                <div className="absolute left-16 right-4 top-[16px] h-[84px] rounded-lg bg-indigo-100 border border-indigo-200 px-3 py-2">
                    <div className="text-[10px] font-mono text-indigo-700">09:00–11:00</div>
                    <div className="text-sm font-semibold text-gray-900">Sprint review</div>
                    <div className="text-xs text-gray-600">Product Alpha</div>
                </div>
                <div className="absolute left-16 right-[48%] top-[148px] h-[64px] rounded-lg bg-blue-100 border border-blue-200 px-3 py-2">
                    <div className="text-[10px] font-mono text-blue-700">12:00–13:30</div>
                    <div className="text-sm font-semibold text-gray-900">Drive to office</div>
                </div>
                <div className="absolute left-[52%] right-4 top-[148px] h-[48px] rounded-lg bg-emerald-100 border border-emerald-200 px-3 py-2">
                    <div className="text-[10px] font-mono text-emerald-700">12:00–13:00</div>
                    <div className="text-sm font-semibold text-gray-900">Call with B</div>
                </div>
                <div className="absolute left-16 right-4 top-[236px] h-[52px] rounded-lg bg-amber-100 border border-amber-200 px-3 py-2">
                    <div className="text-[10px] font-mono text-amber-800">14:00–15:00</div>
                    <div className="text-sm font-semibold text-gray-900">Client dinner prep</div>
                    <div className="text-xs text-gray-600">¥12,000 · 交際費</div>
                </div>
                <div className="absolute left-0 right-0 top-[200px] h-0.5 bg-red-500">
                    <span className="absolute left-3 -top-3 text-[10px] font-semibold text-red-600">Now</span>
                </div>
            </div>
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-600 bg-white">
                Unscheduled: Inbox triage · Expense report
            </div>
        </div>
    );
}

export function AnalyticsMock() {
    return (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden text-left">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">Analytics · Sep 2026</span>
                <span className="text-xs text-gray-600">Month</span>
            </div>
            <div className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                    <MockKpi label="Logged" value="86h" />
                    <MockKpi label="Spend" value="¥184,000" />
                    <MockKpi label="Budget left" value="¥16,000" accent="text-emerald-700" />
                </div>
                <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">Projects</div>
                    <MockBar name="Product Alpha" actual="62h" expected="60h" width="92%" over />
                    <MockBar name="Client Bravo" actual="18h" expected="24h" width="55%" />
                    <MockBar name="Internal" actual="6h" expected="8h" width="28%" />
                </div>
                <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">Money</div>
                    <MockBar name="Tickets" actual="¥42,000" expected="¥40,000" width="80%" over />
                    <MockBar name="Dining" actual="¥71,000" expected="¥80,000" width="70%" />
                    <MockBar name="Subscriptions" actual="¥21,000" expected="¥20,000" width="40%" over />
                </div>
            </div>
        </div>
    );
}

function MockKpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <div className="text-[10px] text-gray-500">{label}</div>
            <div className={`text-sm font-bold ${accent ?? 'text-gray-900'}`}>{value}</div>
        </div>
    );
}

function MockBar({
    name,
    actual,
    expected,
    width,
    over,
}: {
    name: string;
    actual: string;
    expected: string;
    width: string;
    over?: boolean;
}) {
    return (
        <div className="mb-2">
            <div className="flex justify-between text-xs text-gray-800 mb-1">
                <span>{name}</span>
                <span className={over ? 'text-red-600' : 'text-gray-600'}>{actual} / {expected}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width }} />
            </div>
        </div>
    );
}
