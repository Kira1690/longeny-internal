-- Create all 5 databases for LONGENY microservices
-- longeny_auth is created by default (POSTGRES_DB)

CREATE DATABASE longeny_core;
CREATE DATABASE longeny_bookings;
CREATE DATABASE longeny_ai_content;
CREATE DATABASE longeny_payments;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE longeny_auth TO longeny;
GRANT ALL PRIVILEGES ON DATABASE longeny_core TO longeny;
GRANT ALL PRIVILEGES ON DATABASE longeny_bookings TO longeny;
GRANT ALL PRIVILEGES ON DATABASE longeny_ai_content TO longeny;
GRANT ALL PRIVILEGES ON DATABASE longeny_payments TO longeny;

-- Enable extensions on all databases
\c longeny_auth
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c longeny_core
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c longeny_bookings
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c longeny_ai_content
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

\c longeny_payments
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
