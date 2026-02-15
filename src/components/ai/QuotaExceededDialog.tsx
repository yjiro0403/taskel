'use client';

import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { PLAN_LIMITS } from '@/lib/billing/plans';
import { motion, AnimatePresence } from 'framer-motion';

interface QuotaExceededDialogProps {
  isOpen: boolean;
  onClose: () => void;
  used: number;
  limit: number;
  plan: string;
}

export const QuotaExceededDialog: React.FC<QuotaExceededDialogProps> = ({
  isOpen,
  onClose,
  used,
  limit,
  plan,
}) => {
  const { createCheckoutSession } = useStore();

  const handleUpgrade = async (priceId: string) => {
    const url = await createCheckoutSession(priceId);
    if (url) window.location.href = url;
  };

  const proPriceId = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;
  const businessPriceId = process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-[200]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center z-[201] p-4"
          >
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-amber-600">
                  <Sparkles size={20} />
                  <h3 className="font-semibold text-lg">AI利用上限に達しました</h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-gray-100 rounded-full"
                >
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                今月のAI利用回数（{used}/{limit}回）を使い切りました。
                プランをアップグレードして、より多くのAI機能をご利用ください。
              </p>

              <div className="space-y-3">
                {plan === 'free' && proPriceId && (
                  <button
                    onClick={() => handleUpgrade(proPriceId)}
                    className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                  >
                    Pro にアップグレード（¥{PLAN_LIMITS.pro.priceJPY.toLocaleString()}/月・{PLAN_LIMITS.pro.monthlyRequestLimit}回）
                  </button>
                )}
                {(plan === 'free' || plan === 'pro') && businessPriceId && (
                  <button
                    onClick={() => handleUpgrade(businessPriceId)}
                    className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
                  >
                    Business にアップグレード（¥{PLAN_LIMITS.business.priceJPY.toLocaleString()}/月・無制限）
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  後で検討する
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
