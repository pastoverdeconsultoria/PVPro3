import type { ReactNode } from 'react';

/** Tela ainda sem dado: diz o que vai aparecer ali e o que falta para aparecer. */
export function EmptyPage({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">{title}</h1>
        <p className="k m-0">{lead}</p>
      </div>
      <section className="card flex flex-col gap-2.5">{children}</section>
    </div>
  );
}
