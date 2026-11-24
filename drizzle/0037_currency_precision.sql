-- Currency rates keep 10 decimals: 1 Toman is about 0.0016 PKR, and 4 decimals would be off by 1%.
ALTER TABLE "currency_rates" ALTER COLUMN "rate" TYPE numeric(20, 10);
