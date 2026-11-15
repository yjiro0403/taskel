'use client';

import SettingsLayout from '@/components/SettingsLayout';
import McpTokensSection from '@/components/settings/McpTokensSection';

export default function IntegrationsSettingsPage() {
    return (
        <SettingsLayout>
            <div className="space-y-8">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">外部連携</h2>
                    <p className="text-sm text-gray-500">
                        外部ツールとのAPI連携を設定します。
                    </p>
                </div>
                <McpTokensSection />
            </div>
        </SettingsLayout>
    );
}
