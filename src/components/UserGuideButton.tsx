'use client';

import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { HelpCircle, Book } from 'lucide-react';
import Link from 'next/link';

export default function UserGuideButton({ onClick }: { onClick?: () => void }) {
    const startTour = () => {
        const driverObj = driver({
            showProgress: true,
            animate: true,
            steps: [
                {
                    element: '#tour-add-task-btn',
                    popover: {
                        title: 'タスクを追加',
                        description: 'ここから新しいタスクを追加します。まずは今日のやることを全て書き出しましょう。'
                    }
                },
                {
                    element: '#tour-task-list',
                    popover: {
                        title: 'タスクリスト',
                        description: '追加したタスクはここに時系列で表示されます。セクションごとに終了予定時刻が自動計算されます。'
                    }
                },
                {
                    element: '.tour-play-btn',
                    popover: {
                        title: '実行と記録',
                        description: 'タスクを開始する時はこの再生ボタンを押します。完了したらチェックボタンを押してください。実績時間が記録されます。'
                    }
                }
            ]
        });

        driverObj.drive();
        if (onClick) onClick();
    };

    return (
        <div className="space-y-2">
            <button
                onClick={startTour}
                className="w-full flex items-center gap-3 text-gray-700 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors text-left"
            >
                <HelpCircle size={18} />
                <span>ツアーを開始</span>
            </button>
            <a
                href="/guide"
                className="w-full flex items-center gap-3 text-gray-700 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors text-left"
            >
                <Book size={18} />
                <span>ヘルプセンター</span>
            </a>
        </div>
    );
}
