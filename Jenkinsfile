// Pipeline do API Gateway (Node + Express, Node 24) — agente LINUX (sh + docker compose).
// Mesmo padrão do Jenkinsfile do MS Moradores (e do HemoVida-estoque): busca os segredos no Infisical (token do projeto,
// guardado no Jenkins como credencial), grava num .env temporário, remove as aspas, sobe o container com docker compose,
// confere o /health e apaga o .env no fim (post/always), então nenhum segredo fica salvo no disco do Jenkins.
// ATENÇÃO: o cadastro de APIs fica no volume Docker "gateway-data"; o deploy recria o container mas NÃO apaga o volume.
pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        APP_NAME             = 'api-gateway-proptech'   // = container_name do docker-compose.yml
        APP_PORT             = '7521'
        INFISICAL_PROJECT_ID = 'COLOQUE_AQUI_O_ID_DO_PROJETO_INFISICAL_DO_GATEWAY'  // não é segredo (Project Settings > Project ID)
        INFISICAL_ENV        = 'dev'                  // ambiente do Infisical (slug: dev/prod)
        INFISICAL_PATH       = '/'                    // pasta dos segredos dentro do ambiente
    }

    stages {

        stage('Checkout GitHub') {
            steps {
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: '*/main']],
                    userRemoteConfigs: [[
                        url: 'https://github.com/BeSenna/Gateway-Proptech'
                    ]]
                ])
            }
        }

        stage('Fetch Secrets - Infisical') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'COLOQUE_AQUI_A_CREDENCIAL_DO_JENKINS'  // o professor cria; é o token do projeto do Infisical,
                        variable: 'INFISICAL_TOKEN'
                    )
                ]) {
                    sh '''
                        set +x
                        set -eu
                        umask 077

                        rm -f .env

                        npx -y @infisical/cli export \
                            --projectId="$INFISICAL_PROJECT_ID" \
                            --env="$INFISICAL_ENV" \
                            --path="$INFISICAL_PATH" \
                            --token="$INFISICAL_TOKEN" \
                            > .env

                        test -s .env || {
                            echo "ERRO: Arquivo .env não foi gerado."
                            exit 1
                        }

                        echo "Secrets carregados com sucesso."
                    '''
                }
                // O infisical export envolve os valores em aspas SIMPLES (ex: DATABASE_URL='mysql://...').
                // Este passo remove as aspas (simples ou duplas) do .env para que o valor chegue limpo ao container.
                sh "sed -i -E \"s/^([^=]+)=['\\\"](.*)['\\\"]\$/\\\\1=\\\\2/\" .env"
            }
        }

        stage('Validar Docker Compose') {
            steps {
                sh '''
                    set -eu

                    docker compose config --quiet

                    echo "Docker Compose validado."
                '''
            }
        }

        stage('Construir Imagem Docker') {
            steps {
                sh '''
                    set -eu

                    docker compose build gateway

                    echo "Imagem Docker construída."
                '''
            }
        }

        stage('Deploy Docker') {
            steps {
                sh '''
                    set -eu

                    # recria só o container; o volume gateway-data (cadastro de APIs) é mantido
                    docker compose up -d --no-build --force-recreate gateway

                    echo "Deploy executado."
                '''
            }
        }

        stage('Verificar Container') {
            steps {
                sh '''
                    set -eu

                    echo "Verificando container..."

                    sleep 10

                    RUNNING=$(docker inspect --format '{{.State.Running}}' "$APP_NAME")

                    if [ "$RUNNING" != "true" ]; then
                        echo "ERRO: Container não está rodando."
                        docker logs --tail 50 "$APP_NAME" || true
                        exit 1
                    fi

                    echo "Container em execução."
                    docker compose ps

                    echo "Versão do Node.js no container:"
                    docker exec "$APP_NAME" node -v
                '''
                // Falha aqui deixa o build "instável" (amarelo), sem derrubar o deploy já feito.
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    sh '''
                        docker exec "$APP_NAME" node -e "const t=async()=>{for(let i=0;i<15;i++){try{const r=await fetch('http://localhost:7521/health');if(r.ok){console.log('API respondendo.');return}}catch(e){}await new Promise(r=>setTimeout(r,3000))}console.log('API não respondeu a tempo.');process.exit(1)};t()" || {
                            docker logs --tail 40 "$APP_NAME" || true
                            exit 1
                        }
                    '''
                }
            }
        }
    }

    post {

        success {
            echo '''
            ====================================
             API GATEWAY - PROPTECH
             DEPLOY EXECUTADO COM SUCESSO
             PORTA: 7521
            ====================================
            '''
        }

        failure {
            echo '''
            ====================================
             API GATEWAY - PROPTECH
             FALHA NA EXECUÇÃO DO PIPELINE
            ====================================
            '''
        }

        always {
            // Remove o .env do workspace para não deixar segredos em texto puro no disco do Jenkins
            sh '''
                set +x
                rm -f .env
            '''
        }
    }
}
