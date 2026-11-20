"use client";

import { motion } from "framer-motion";

import { ConnectionCard } from "@/components/dashboard/connection-card";
import { DashboardHeader } from "@/components/dashboard/header";
import { KeyManager } from "@/components/dashboard/key-manager";
import { ModelsManager } from "@/components/dashboard/models-manager";
import { ProvidersManager } from "@/components/dashboard/providers-manager";
import { SiteFooter } from "@/components/dashboard/site-footer";
import { TaskBoard } from "@/components/dashboard/task-board";
import { useHealthPoller } from "@/components/dashboard/shared";

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
} as const;

export default function Home() {
  const { health, loading, failed, refresh } = useHealthPoller();

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader health={health} loading={loading} failed={failed} onRetry={refresh} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* (أ) مدير المفاتيح */}
          <motion.section
            aria-label="مدير المفاتيح"
            className="h-full"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
          >
            <KeyManager className="h-full" />
          </motion.section>

          {/* (ب) لوحة المهام */}
          <motion.section
            aria-label="لوحة المهام"
            className="h-full"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
          >
            <TaskBoard className="h-full" />
          </motion.section>

          {/* (ج) إدارة المزودين — إعدادات الاتصال الحقيقية من قاعدة البيانات */}
          <motion.section
            aria-label="إدارة المزودين"
            className="h-full"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.15 }}
          >
            <ProvidersManager className="h-full" />
          </motion.section>

          {/* (د) إدارة الموديلات — خرائط canonical ← المزود بالأولوية */}
          <motion.section
            aria-label="إدارة الموديلات"
            className="h-full"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.2 }}
          >
            <ModelsManager className="h-full" />
          </motion.section>

          {/* (هـ) ربط السيرفر — عرض كامل */}
          <motion.section
            aria-label="ربط السيرفر"
            className="lg:col-span-2"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.25 }}
          >
            <ConnectionCard health={health} />
          </motion.section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
