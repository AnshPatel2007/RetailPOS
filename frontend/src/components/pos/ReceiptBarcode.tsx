import { useEffect, useState } from 'react';
import { receiptCodeMarkup } from '@/services/receiptBarcode';

export function ReceiptBarcode({ reference }: { reference: string }) {
  const [markup, setMarkup] = useState('');
  useEffect(() => {
    let active = true; setMarkup('');
    receiptCodeMarkup(reference).then(value => { if (active) setMarkup(value); }).catch(() => {});
    return () => { active = false; };
  }, [reference]);
  return markup ? <div className="my-2 text-center">
    <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: markup }} />
    <p className="text-[10px] text-gray-600">Scan for returns and receipt lookup</p>
  </div> : null;
}
