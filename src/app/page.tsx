"use client";

import { motion } from "framer-motion";

import { ConnectionCard } from "@/components/dashboard/connection-card";
import { DashboardHeader } from "@/components/dashboard/header";
import { KeyManager } from "@/components/dashboard/key-manager";
import { SiteFooter } from "@/components/dashboard/site-footer";
import { TaskBoard } from "@/components/dashboard/task-board";
import { GenerationStudio } from "@/components/dashboard/studio";
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
          {/* (أ) استوديو التوليد — صورة/فيديو مباشرة عبر المفاتيح بالترتيب التسلسلي */}
          <motion.section
            aria-label="استوديو التوليد"
            className="lg:col-span-2"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.03 }}
          >
            <GenerationStudio />
          </motion.section>

          {/* (ب) مدير المفاتيح */}
          <motion.section
            aria-label="مدير المفاتيح"
            className="h-full"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.08 }}
          >
            <KeyManager className="h-full" />
          </motion.section>

          {/* (ج) لوحة المهام */}
          <motion.section
            aria-label="لوحة المهام"
            className="h-full"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.12 }}
          >
            <TaskBoard className="h-full" />
          </motion.section>

          {/* (د) ربط السيرفر — عرض كامل */}
          <motion.section
            aria-label="ربط السيرفر"
            className="lg:col-span-2"
            {...fadeUp}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.19 }}
          >
            <ConnectionCard health={health} />
          </motion.section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
