'use client';

import dynamic from 'next/dynamic';
import { useEffect, type ComponentProps } from 'react';

import type AddTaskModalComponent from './AddTaskModal';

type AddTaskModalProps = ComponentProps<typeof AddTaskModalComponent>;

// AddTaskModal は 1,000 行超・約 50 個の hooks を持ち、閉じていてもストア購読と
// 状態初期化を毎レンダーで行う。/tasks では 4 箇所、年間ビューでは 13 箇所に
// 置かれているため、閉じている間はマウントしない。本体のチャンクは最初に開く
// までダウンロードせず、初期表示から外す（react-markdown / アラーム / 金額入力 UI を含む）。
const AddTaskModalDynamic = dynamic(() => import('./AddTaskModal'), { ssr: false });

let prefetched = false;
const prefetchAddTaskModal = () => {
    if (prefetched) return;
    prefetched = true;
    // 初回オープンの待ちを無くすため、画面が落ち着いたらバックグラウンドで取り寄せておく。
    const run = () => {
        void import('./AddTaskModal');
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 3_000 });
    } else {
        setTimeout(run, 1_500);
    }
};

/**
 * AddTaskModal と同じ props を受け取る軽量ラッパー。閉じている間は何も描画・購読しない。
 */
export default function LazyAddTaskModal(props: AddTaskModalProps) {
    useEffect(() => {
        prefetchAddTaskModal();
    }, []);

    if (!props.isOpen) {
        return null;
    }
    return <AddTaskModalDynamic {...props} />;
}
