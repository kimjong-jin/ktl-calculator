import { head } from '@vercel/blob';

const BLOB_KEY = 'access-codes.json';
const token = 'vercel_blob_rw_FHDWJS29ZUlHvsbS_eTAVcHSJbAKbFCONwU3NHdM3Mqe7pL';

async function run() {
  try {
    const meta = await head(BLOB_KEY, { token });
    if (!meta) {
      console.log('No metadata found for blob.');
      return;
    }
    const url = meta.downloadUrl || meta.url;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
      },
    });
    if (!res.ok) {
      console.log('Failed to fetch blob contents:', res.status);
      return;
    }
    const map = await res.json();
    console.log(JSON.stringify(map, null, 2));
  } catch (e) {
    console.error('Error reading blob:', e);
  }
}
run();
