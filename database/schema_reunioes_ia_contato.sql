-- Troca "empresa ou vínculo" por telefone de contato e produto/serviço,
-- que fazem mais sentido pro fluxo real de gerar e mandar o link.
ALTER TABLE reunioes_ia ADD COLUMN IF NOT EXISTS cliente_telefone TEXT;
ALTER TABLE reunioes_ia ADD COLUMN IF NOT EXISTS produto_servico TEXT;
