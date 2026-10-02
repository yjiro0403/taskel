import { useCallback } from "react";

// driver.js（本体 + CSS）はツアーを実際に始めるときだけ読み込む。
// ツアーはユーザーごとに一度しか走らないので、毎回の初期バンドルに含めない。
export const useTour = () => {
    const startTour = useCallback(async () => {
        const [{ driver }] = await Promise.all([
            import("driver.js"),
            import("driver.js/dist/driver.css"),
        ]);

        const driverObj = driver({
            showProgress: true,
            animate: true,
            steps: [
                {
                    element: '#tour-task-list',
                    popover: {
                        title: 'タスクリスト',
                        description: 'ここには毎日のタスクが表示されます。チュートリアル用のタスクが用意されています。'
                    }
                },
                {
                    element: '.tour-play-btn',
                    popover: {
                        title: '実行と記録',
                        description: 'タスクを開始する時はこの再生ボタンを押します。完了したらチェックボタンを押してください。実績時間が記録されます。'
                    }
                },
                {
                    element: '#tour-add-task-btn',
                    popover: {
                        title: 'タスクを追加',
                        description: '自分のタスクを追加する時はここから。まずは今日のやることを全て書き出しましょう。'
                    }
                },
                {
                    popover: {
                        title: '準備完了！',
                        description: 'さあ、チュートリアルタスクの再生ボタンを押して体験してみましょう。'
                    }
                }
            ]
        });

        driverObj.drive();
    }, []);

    return { startTour };
};
