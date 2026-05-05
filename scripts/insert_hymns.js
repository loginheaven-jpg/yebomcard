const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const jsonPath = path.resolve(__dirname, '../hymns_korean_645.json');
  const rawData = fs.readFileSync(jsonPath, 'utf-8');
  const hymns = JSON.parse(rawData);

  console.log(`Loaded ${hymns.length} hymns from JSON.`);

  // To insert efficiently and not hit payload limits, we chunk the inserts
  const CHUNK_SIZE = 100;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < hymns.length; i += CHUNK_SIZE) {
    const chunk = hymns.slice(i, i + CHUNK_SIZE);
    
    // Check if table exists by doing a quick select
    if (i === 0) {
        const { error: checkErr } = await supabase.from('hymns').select('id').limit(1);
        if (checkErr && checkErr.code === '42P01') {
            console.error("\n[Error] The 'hymns' table does not exist!");
            console.error("Please run the 'hymns_create_table.sql' script in your Supabase SQL Editor first.");
            process.exit(1);
        }
    }

    const { data, error } = await supabase
      .from('hymns')
      .upsert(chunk, { onConflict: 'number' }); // assuming number is unique, but if not we can just insert

    if (error) {
      console.error(`Error inserting chunk ${i} - ${i + chunk.length - 1}:`, error.message);
      errorCount += chunk.length;
    } else {
      successCount += chunk.length;
      console.log(`Inserted ${successCount} / ${hymns.length} hymns...`);
    }
  }

  console.log(`\nFinished inserting hymns!`);
  console.log(`Success: ${successCount}, Errors: ${errorCount}`);
}

main().catch(console.error);
