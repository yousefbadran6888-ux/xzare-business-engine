import {it,expect} from 'vitest'
import {refreshReceipt} from './receipt-refresh'
it('open receipt follows manager void returned by refreshed state',()=>{const p={id:'P',voidReason:null} as any;expect(refreshReceipt(p,[{...p,voidReason:'correction'}])).toMatchObject({voidReason:'correction'})})
it('receipt outside latest list closes until fresh membership detail read',()=>expect(refreshReceipt({id:'P'} as any,[])).toBeNull())
