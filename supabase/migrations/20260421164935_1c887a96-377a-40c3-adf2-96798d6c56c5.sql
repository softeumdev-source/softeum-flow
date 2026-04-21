
-- Cria um usuário de teste via SQL (bypass da API REST)  
-- Este método insere diretamente nas tabelas internas do Supabase

-- Gera UUIDs determinísticos baseados no email
-- demo@softeum.com

-- Primeiro, verifica se o usuário já existe
DO $$
DECLARE
    v_user_id UUID := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::UUID;
    v_tenant_id UUID := '2b0389b5-e9bd-4279-8b2f-794ba132cdf5'::UUID;
BEGIN
    -- Insere na tabela auth.users (usando extensão pgcrypto para hash da senha)
    INSERT INTO auth.users (
        id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
    ) VALUES (
        v_user_id,
        'demo@softeum.com',
        crypt('Demo123456!', gen_salt('bf')),
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"nome":"Usuário Demo"}'::jsonb,
        NOW(),
        NOW(),
        '',
        '',
        '',
        ''
    )
    ON CONFLICT (id) DO UPDATE SET
        encrypted_password = crypt('Demo123456!', gen_salt('bf')),
        email_confirmed_at = NOW(),
        updated_at = NOW();

    -- Insere no tenant_membros
    INSERT INTO public.tenant_membros (user_id, tenant_id, papel, nome, ativo)
    VALUES (v_user_id, v_tenant_id, 'admin', 'Usuário Demo', true);
    
    RAISE NOTICE 'Usuário demo@softeum.com criado com sucesso!';
END $$;
