require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fuzzyTerm = '나%같%은%죄%인';
supabase.from('hymns').select('number, korean_title').or(`korean_title.ilike.%${fuzzyTerm}%,korean_lyrics.ilike.%${fuzzyTerm}%`).then(res => console.log(JSON.stringify(res.data, null, 2)));
